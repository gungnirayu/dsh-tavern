import assert from 'node:assert/strict'
import test from 'node:test'
import { projectionFixture } from './fixtures/session-view-projection.mjs'

test('full and dirty projections derive the latest assistant turn through the production interface', async () => {
  const f = projectionFixture()
  const first = await f.projection.project.full(f.chat)
  assert.equal(first.latestAssistantTurn, 1)
  const messages = [...f.chat.messages]
  for (let turn = 2; turn <= 15; turn++) {
    messages.push({ role: 'user', turn, text: '行动' }, { role: 'assistant', turn, text: '正文 ' + turn })
    f.events.push({ type: 'turn/start', data: { turn } }, { type: 'assistant/message', data: { turn, message: { id: 'm' + turn, source: { kind: 'model' }, content: [{ type: 'text', text: '正文' }] } } })
  }
  const next = { ...f.chat, _storageRevision: 2, messages }
  const fields = await f.projection.project.dirty(next, first, new Set(messages.map((_, index) => index)), { busy: false }, { layoutChanged: true, layoutFrom: 1 })
  assert.equal(fields.latestAssistantTurn, 15)
  assert.equal(fields.latestAssistantMessageId, 'm15')
  assert.deepEqual(fields.debugTurns.map(item => item.turn), [15,14,13,12,11,10,9,8,7,6,5,4])
  assert.equal(first.latestAssistantTurn, 1)
})
