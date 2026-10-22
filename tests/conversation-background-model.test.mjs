import { createConversationBackgroundSettings } from '../tavern-plugin/lib/domain/conversation-background-settings.js'
import assert from 'node:assert/strict'
import test from 'node:test'

test('本局模型保存保留并发更新的剧情，只修改所选游戏，允许恢复跟随前台', async () => {
  const chats = new Map([['one', { id: 'one', mode: 'story', messages: ['old'] }], ['two', { id: 'two', mode: 'story' }]])
  const settings = createConversationBackgroundSettings({
    readChat: async id => structuredClone(chats.get(id)),
    readConfig: async id => chats.get(id), isPlayMode: mode => mode === 'story',
    modelReasoning: async () => ({ efforts: [{ id: 'high' }] }),
    modelCatalog: async () => [{ provider: 'test', models: [{ id: 'new' }] }],
    updateChat: async (id, mutation) => {
      const current = { ...chats.get(id), messages: ['old', 'concurrent update'] }
      const saved = mutation(current); chats.set(id, saved); return saved
    }
  })
  const call = backgroundModel => settings.save({ sessionId: 'one', backgroundModel })
  await call({ provider: 'test', model: 'new', reasoningEffort: 'high' })
  assert.deepEqual(chats.get('one').backgroundModelSelection, { provider: 'test', model: 'new', reasoningEffort: 'high' })
  assert.deepEqual(chats.get('one').messages, ['old', 'concurrent update'])
  assert.equal(chats.get('two').backgroundModelSelection, undefined)
  assert.equal(chats.get('one').backgroundConfigVersion, 1)
  await assert.rejects(call({ provider: 'test', model: 'new', reasoningEffort: 'invalid' }), /推理强度不可用/)
  assert.equal(chats.get('one').backgroundModelSelection.reasoningEffort, 'high')
  await call(null)
  assert.equal(chats.get('one').backgroundModelSelection, null)
  await assert.rejects(call({}), /配置无效/)
  await assert.rejects(settings.save({ sessionId: 'missing', backgroundModel: null }), /游玩会话/)
})

test('configuration read stays narrow and enabling style recall runs only after a successful save', async () => {
  let chat = { id: 'one', mode: 'story', mvu: { enabled: true, owner: 'official' }, backgroundTasks: { styleReference: false } }
  const calls = []
  let fail = false
  const settings = createConversationBackgroundSettings({
    readConfig: async () => { calls.push('read-config'); return chat },
    readChat: async () => { calls.push('read-chat'); return chat },
    updateChat: async (_id, mutate) => { calls.push('write'); if (fail) throw new Error('write failed'); return chat = mutate(chat) },
    isPlayMode: mode => mode === 'story',
    modelCatalog: async () => [], modelReasoning: async () => null,
    onStyleEnabled: (sessionId, chatId) => calls.push(['style', sessionId, chatId])
  })
  assert.equal((await settings.read('game')).mvuCard, true)
  assert.deepEqual(calls, ['read-config'])
  fail = true
  await assert.rejects(settings.save({ sessionId: 'game', backgroundTasks: { styleReference: true } }), /write failed/)
  assert.equal(calls.some(Array.isArray), false)
  fail = false
  await settings.save({ sessionId: 'game', backgroundTasks: { styleReference: true } })
  await settings.save({ sessionId: 'game', backgroundTasks: { styleReference: true } })
  assert.deepEqual(calls.filter(Array.isArray), [['style', 'game', 'one']])
})
