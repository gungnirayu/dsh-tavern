import test from 'node:test'
import assert from 'node:assert/strict'

import { compileSillyTavernRequest, createCleanCompatibilityPreset } from '../tavern-plugin/lib/domain/sillytavern-compatibility.js'

function resolveMacros(text, context) {
  return { text: String(text).replaceAll('{{char}}', context.charName).replaceAll('{{user}}', context.macroState.userName), diagnostics: [], macroState: context.macroState }
}

test('对话示例只识别与当前玩家和角色名匹配的英文冒号前缀', () => {
  const mismatch = compileSillyTavernRequest({
    card: { name: '角色', mes_example: '玩家：不应进入\n角色：也不应进入' },
    preset: { entries: [
      { entryKey: 'examples#1', identifier: 'dialogueExamples', marker: true, role: 'system', content: '', enabled: true, ordered: true }
    ] },
    presetDocument: { new_example_chat_prompt: '[开始示例]' }, userName: '你', resolveMacros
  })
  assert.deepEqual(mismatch.messages, [])

  const matched = compileSillyTavernRequest({
    card: { name: '角色', mes_example: '你: 问候\n角色: 回答' },
    preset: { entries: [
      { entryKey: 'examples#1', identifier: 'dialogueExamples', marker: true, role: 'system', content: '', enabled: true, ordered: true }
    ] },
    presetDocument: { new_example_chat_prompt: '[开始示例]' }, userName: '你', resolveMacros
  })
  assert.deepEqual(matched.messages.map(function (item) { return [item.role, item.name || '', item.content] }), [
    ['system', '', '[开始示例]'],
    ['system', 'example_user', '问候'],
    ['system', 'example_assistant', '回答']
  ])
})

test('请求编译保留历史图片和本轮纯图片输入', async () => {
  const oldImage = { type: 'image', attachment: { id: 'old-photo' } }
  const newImage = { type: 'image', attachment: { id: 'new-photo' } }
  const result = compileSillyTavernRequest({
    card: { name: '角色' }, preset: createCleanCompatibilityPreset(), presetDocument: {},
    history: [{ role: 'user', text: '看图', inputAttachments: [oldImage] }, { role: 'assistant', text: '好的' }],
    input: '', inputAttachments: [newImage], resolveMacros
  })
  assert.deepEqual(result.messages.flatMap(message => message.inputAttachments || []), [oldImage, newImage])
})
