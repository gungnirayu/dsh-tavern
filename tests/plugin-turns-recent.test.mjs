import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createPluginTurnReader } from '../tavern-plugin/lib/domain/plugin-turns.js'

test('存储只读最近几层楼的摘要：位置、轮次与结算标记都在，不带正文', async t => {
  const root = await mkdtemp(join(tmpdir(), 'recent-summaries-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const messages = [{ role: 'assistant', greeting: true, text: '开场' }]
  for (let turn = 2; turn <= 60; turn++) messages.push({ role: 'user', text: '输入' + turn }, { role: 'assistant', turn, text: '正文' + turn, mvu: { pending: turn === 60 } })
  await p.write({ id: 'c', sessionId: 's', mode: 'story', messages })
  const recent = await p.readRecentSummaries('c', 5)
  assert.equal(recent.messageCount, messages.length)
  assert.equal(recent.from, messages.length - 5)
  assert.deepEqual(recent.messages.map(row => [row.role, row.turn ?? null]), messages.slice(-5).map(row => [row.role, row.turn ?? null]))
  assert.equal(recent.messages.at(-1).mvu.pending, true)
  assert.equal(recent.messages.at(-1).text, undefined)
})

function reader({ rounds = 60, recent = true } = {}) {
  const messages = [{ role: 'assistant', greeting: true }]
  for (let turn = 2; turn <= rounds; turn++) messages.push({ role: 'user' }, { role: 'assistant', turn })
  const calls = { whole: 0 }
  const game = { id: 'c', sessionId: 's', mode: 'story' }
  const pluginTurns = createPluginTurnReader({
    sessionState: async () => { calls.whole++; return { ...game, messages } },
    recentState: recent ? async (_id, count) => ({ ...game, messages: messages.slice(-count), messagesFrom: Math.max(0, messages.length - count) }) : undefined,
    sceneState: async () => null,
    header: async () => ({ settleStatus: 'done' }),
    slice: async () => null, fullChat: async () => null, readChatCard: async () => null
  })
  return { pluginTurns, calls, messages }
}

test('插件读最近一轮只读最近几层楼；读很早的一轮才退回完整摘要', async () => {
  const { pluginTurns, calls } = reader()
  // sceneState is null: material stops at the scene target, after locating the floor.
  assert.equal(await pluginTurns.readLatestSettledTurn('s'), null)
  assert.equal(calls.whole, 0)
  assert.equal(await pluginTurns.readTurn('s', 3), null)
  assert.equal(calls.whole, 1)
})
