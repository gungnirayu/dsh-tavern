import test from 'node:test'
import assert from 'node:assert/strict'
import { projectionFixture } from './fixtures/session-view-projection.mjs'

test('window projection uses real resource revisions and absolute helper ids without poisoning full caches', async () => {
  const f = projectionFixture()
  const chat = { ...f.chat, cardDefinitionSnapshot: { name: '卡' }, openingWorldbookSnapshot: { version: 1, document: null } }
  const full = await f.projection.project.full(chat, { deferResources: true })
  const window = await f.projection.project.opening({ chat: { ...chat, messages: [{ role: 'assistant', turn: 5, text: '窗口正文' }] },
    revision: 9, from: 8, to: 8, messageCount: 9 }, { deferResources: true })
  assert.deepEqual(window.historyWindow, { onDemand: true, from: 8, to: 8, messageCount: 9, revision: 9 })
  assert.equal(window.cardResourceAccess.revision, 9)
  assert.equal(window.tavernHelper.messages[0].message_id, 8)
  assert.equal(window.tavernHelper.turnMessageIds['5'], 8)
  assert.equal(window.tavernHelper.historyAccess.revision, 9)
  assert.equal(full.tavernHelper.messages[0].message_id, 0)
  const again = await f.projection.project.full(chat)
  assert.equal(again.tavernHelper.messages[0].message, '开场白')
  assert.deepEqual(f.calls, ['sync', 'warm', 'sync'])
})

test('cache hits refresh activity and script progress without reading card/history resources', async () => {
  let progress = 1, reads = 0
  const f = projectionFixture({ readScript: async () => ({ chunks: [] }), scriptContinuity: { inspect: () => ({ progress }) },
    readChatCard: async () => { reads++; return { name: '卡' } } })
  const chat = { ...f.chat, mode: 'script' }
  const full = await f.projection.project.full(chat)
  progress = 2
  const cached = await f.projection.project.cached(chat, full, { busy: true, phase: 'running', role: 'settlement' })
  assert.equal(reads, 1)
  assert.equal(cached.activity.busy, true)
  assert.equal(cached.scriptProgress.progress, 2)
  assert.equal(full.scriptProgress.progress, 1)
  assert.equal(cached.tavernHelper, full.tavernHelper)
})
