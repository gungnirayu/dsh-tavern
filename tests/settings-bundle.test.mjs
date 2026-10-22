import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSettingsBundle } from '../tavern-plugin/lib/domain/settings-bundle.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createUserPreferenceProfile } from '../tavern-plugin/lib/domain/user-preference-profile.js'

import { createSettingsTransfer } from '../tavern-plugin/lib/domain/settings-transfer.js'
import { createSystemPromptDocuments } from '../tavern-plugin/lib/domain/system-prompt-documents.js'

function memoryStore(initial) {
  let value = initial
  return { async readJson() { return structuredClone(value) }, async updateJson(_path, updater) { value = await updater(structuredClone(value)); return structuredClone(value) } }
}

const NAMES = ['story', 'system-append']
const DEFAULTS = { story: 'default story', 'system-append': '' }

function harness() {
  const presets = new Map()
  let activePreset = ''
  let settings = {}
  const profile = createUserPreferenceProfile({ store: memoryStore(), now: () => 100 })
  const deps = {
    importPreset: async payload => {
      if (presets.has(payload.name)) throw new Error('文件已存在: ' + payload.name)
      presets.set(payload.name, payload.text)
      return { path: payload.name, title: payload.name.replace(/\.json$/, ''), valid: true, recognized: Array.isArray(JSON.parse(payload.text).prompts) }
    },
    presetLibrary: {
      catalog: async () => ({ activePresetPath: activePreset }),
      select: async path => { activePreset = path },
      export: async path => ({ name: path, text: presets.get(path) })
    },
    readTavernSettings: async () => presentTavernSettings(settings, DEFAULTS),
    updateTavernSettings: async patch => { settings = applyTavernSettingsPatch(settings, patch); return presentTavernSettings(settings, DEFAULTS) },
    userPreferenceProfile: profile,
    prepareTextImport: payload => ({ ...payload, text: String(payload.text).trim() }),
    promptDocuments: createSystemPromptDocuments({ definitions: NAMES.map(name => ({ name, label: name })), prompt: name => DEFAULTS[name] })
  }
  const api = createSettingsTransfer(deps)
  return { ...api, presets, profile, active: () => activePreset, settings: () => settings }
}

test('导出的预设包在另一台机器导入后，三部分都作为新方案加入并设为使用中', async () => {
  const from = harness()
  from.presets.set('文风.json', JSON.stringify({ prompts: [{ identifier: 'main', content: 'x' }] }))
  const created = await from.profile.manage({ action: 'create', name: '我的偏好', content: '少写心理描写' })
  await from.profile.manage({ action: 'default', profileId: created.profileId })
  await from.importSettingsBundle({ payload: { name: 'seed.json', text: JSON.stringify({ spec: 'dsh-tavern.system-prompts', version: 1, name: '快节奏', prompts: { story: 'fast story' } }) } })
  const exported = await from.exportSettingsBundle({ include: { preset: true, systemPrompts: true, userProfile: true }, presetPath: '文风.json' })
  assert.match(exported.name, /\.dshpreset\.json$/)
  const bundle = JSON.parse(exported.text)
  assert.equal(bundle.spec, 'dsh-tavern.bundle')
  assert.equal(bundle.systemPrompts.name, '快节奏')
  assert.equal(bundle.userProfile.injectionText, '少写心理描写')

  const to = harness()
  to.presets.set('文风.json', '{"prompts":[]}')
  await to.profile.manage({ action: 'create', name: '我的偏好', content: '本机已有偏好' })
  const result = await to.importSettingsBundle({ payload: { name: exported.name, text: exported.text } })
  assert.equal(result.imported.preset.path, '文风 (2).json', '同名预设不覆盖')
  assert.equal(to.active(), '文风 (2).json')
  assert.equal(to.settings().promptOverrides.story, 'fast story')
  assert.equal(result.imported.userProfile.name, '我的偏好 (2)')
  const library = await to.profile.read()
  assert.equal(library.defaultProfileId, result.imported.userProfile.id)
  assert.equal((await to.profile.read(result.imported.userProfile.id)).confirmed.injectionText, '少写心理描写')
})

test('导入单独的酒馆预设只填预设，不碰系统提示词和长期偏好', async () => {
  const h = harness()
  const result = await h.importSettingsBundle({ payload: { name: 'st.json', text: JSON.stringify({ prompts: [] }) } })
  assert.equal(result.kind, 'preset')
  assert.deepEqual(Object.keys(result.imported), ['preset'])
  assert.equal(h.settings().promptSets, undefined)
})

test('导入时可跳过某一部分，系统提示词与默认相同的条目不保存为修改', async () => {
  const h = harness()
  const bundle = buildSettingsBundle({ name: '包', preset: { name: 'p.json', text: '{"prompts":[]}' }, systemPrompts: { spec: 'dsh-tavern.system-prompts', version: 1, prompts: { story: 'default story' } } })
  const result = await h.importSettingsBundle({ payload: { name: 'x.json', text: JSON.stringify(bundle) }, include: { preset: false } })
  assert.deepEqual(Object.keys(result.imported), ['systemPrompts'])
  assert.equal(h.presets.size, 0)
  assert.equal(h.settings().promptOverrides, undefined)
  assert.equal(result.imported.systemPrompts.name, '包')
})

test('无法识别的文件和空导出给出明确错误', async () => {
  const h = harness()
  await assert.rejects(h.importSettingsBundle({ payload: { name: 'x.json', text: '{"hello":1}' } }), /无法识别/)
  await assert.rejects(h.exportSettingsBundle({ include: {} }), /至少选择一项/)
  await assert.rejects(h.exportSettingsBundle({ include: { preset: true } }), /没有选中的预设/)
})

test('系统提示词校验失败时不先导入预设或切换长期偏好', async () => {
  const h = harness()
  const bundle = buildSettingsBundle({ name: '错误提示词包', preset: { name: 'new.json', text: '{"prompts":[]}' },
    systemPrompts: { spec: 'dsh-tavern.system-prompts', version: 1, prompts: { story: '' } } })
  await assert.rejects(h.importSettingsBundle({ payload: { name: 'bad.json', text: JSON.stringify(bundle) } }), /缺少有效内容/)
  assert.equal(h.presets.size, 0)
  assert.equal(h.active(), '')
  assert.deepEqual(h.settings(), {})
})
