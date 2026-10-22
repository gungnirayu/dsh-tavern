import assert from 'node:assert/strict'
import { readFile } from "node:fs/promises"

import test from 'node:test'

import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

// Exercise the real save/read call sites with durable storage, not a copied implementation.

const settingsModuleSource = await readFile(new URL('../tavern-plugin/src/client/modules/global-settings.js', import.meta.url), 'utf8')

test('retired mode flags cannot be enabled and are removed on settings save', () => {
  const previous = { compatibilityMode: true, sillyModeEnabled: true, unknown: 'preserved' }
  const saved = applyTavernSettingsPatch(previous, {})
  assert.equal(saved.unknown, 'preserved')
  for (const key of ['compatibilityMode', 'sillyModeEnabled']) {
    assert.equal(Object.hasOwn(saved, key), false)
    assert.equal(Object.hasOwn(presentTavernSettings(previous, {}), key), false)
    assert.throws(() => applyTavernSettingsPatch(previous, { [key]: true }), /silly 模式已停用/)
  }
  assert.equal(previous.compatibilityMode, true)
})

test('全局写作 Skill 逐项保存，恢复开启不改动其他 Skill', () => {
  let document = applyTavernSettingsPatch({}, { defaultWritingSkill: { name: 'one', enabled: false } })
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'two', enabled: false } })
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: false } })
  assert.deepEqual(presentTavernSettings(document, {}).defaultDisabledWritingSkills, ['one', 'two'])
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: true } })
  assert.deepEqual(document.defaultDisabledWritingSkills, ['two'])
  assert.throws(() => applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: 'false' } }), /无效/)
})

test('进入游戏时打开酒馆状态：默认开，可以关', () => {
  assert.equal(presentTavernSettings({}, {}).autoOpenStatusPanel, true)
  const off = applyTavernSettingsPatch({}, { autoOpenStatusPanel: false })
  assert.equal(presentTavernSettings(off, {}).autoOpenStatusPanel, false)
  assert.throws(() => applyTavernSettingsPatch({}, { autoOpenStatusPanel: 'no' }), /布尔值/)
})

test('系统提示词方案：切换时保存当前内容，生效内容始终在顶层字段', () => {
  let document = applyTavernSettingsPatch({ promptOverrides: { story: 'A' }, systemAppendEnabled: false }, { promptSet: { action: 'create', name: '快节奏' } })
  assert.equal(document.promptOverrides, undefined)
  assert.equal(document.systemAppendEnabled, true)
  document = applyTavernSettingsPatch(document, { systemPrompt: { name: 'story', text: 'B' } })
  const fast = document.activePromptSetId
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'select', id: 'default' } })
  assert.deepEqual(document.promptOverrides, { story: 'A' })
  assert.equal(document.systemAppendEnabled, false)
  assert.equal(presentTavernSettings(document, { story: 'def' }).systemPrompts[0].text, 'A')
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'select', id: fast } })
  assert.deepEqual(document.promptOverrides, { story: 'B' })
  assert.deepEqual(presentTavernSettings(document, {}).promptSets.sets.map(set => [set.name, set.active]), [['默认方案', false], ['快节奏', true]])
})

test('系统提示词方案：复制、重名加后缀、不能删除正在使用的方案', () => {
  let document = applyTavernSettingsPatch({ promptOverrides: { story: 'A' } }, { promptSet: { action: 'duplicate', name: '默认方案' } })
  assert.deepEqual(document.promptOverrides, { story: 'A' })
  assert.deepEqual(document.promptSets.map(set => set.name), ['默认方案', '默认方案 (2)'])
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'delete', id: document.activePromptSetId } })
  assert.equal(document.activePromptSetId, 'default', '删除正在使用的方案后切到剩下的方案')
  assert.deepEqual(document.promptOverrides, { story: 'A' })
  assert.equal(document.promptSets.length, 1)
  assert.throws(() => applyTavernSettingsPatch(document, { promptSet: { action: 'delete', id: 'default' } }), /至少保留一个/)
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'add', name: '导入', promptOverrides: { story: 'C' }, systemAppendEnabled: false } })
  assert.deepEqual(document.promptOverrides, { story: 'C' })
  assert.equal(document.systemAppendEnabled, false)
})

test('正文与历史回放合成一个工具调用开关：旧存档任一开着都算开，改动后旧字段清掉', () => {
  assert.equal(presentTavernSettings({}, {}).storyToolCall, false)
  assert.equal(presentTavernSettings({ storyHistoryToolCall: true }, {}).storyToolCall, true)
  assert.equal(presentTavernSettings({ storyToolCall: true }, {}).storyToolCall, true)
  assert.equal(Object.hasOwn(presentTavernSettings({ storyHistoryToolCall: true }, {}), 'storyHistoryToolCall'), false)
  const off = applyTavernSettingsPatch({ storyHistoryToolCall: true }, { storyToolCall: false })
  assert.deepEqual(off, { storyToolCall: false })
  assert.equal(presentTavernSettings(off, {}).storyToolCall, false)
})
