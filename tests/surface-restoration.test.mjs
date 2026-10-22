import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { restoreSurface, preflightSurfaceRestore } from '../tavern-plugin/lib/domain/surface-restoration.js'
import { foregroundSuppressedTurns } from '../tavern-plugin/lib/domain/rollback-surface.js'

 test('原生 Session 恢复各消息角色，追加日志不制造重复正文，重载仍保持撤销结果', () => {
  let session = Session.create('restore-native')
  appendSessionEvent(session, 'user/message', { id: 'u', turn: 2, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '推门' }] }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'a', role: 'assistant', content: [{ type: 'text', text: '门开了' }], source: { kind: 'model', provider: 'test', model: 'test' } } }, { surfaceOp: 'append' })
  const saved = [...session.surface.nodes]
  const original = sessionEvents(session).map(event => structuredClone(event))
  const seq = sessionEvents(session).length
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'rollback', role: 'assistant', content: [], source: { kind: 'model', provider: 'test', model: 'test' } } },
    { surfaceOp: { op: 'replace', start: saved[0], end: saved.at(-1) }, sourceEventSeqs: saved })
  assert.deepEqual(foregroundSuppressedTurns({}, sessionEvents(session)), [2])
  preflightSurfaceRestore(session, saved)
  restoreSurface(session, saved)
  for (const reload of [false, true]) {
    if (reload) session = Session.create(session.id, sessionEvents(session), session.header)
    const events = sessionEvents(session)
    assert.deepEqual(events.slice(0, original.length), original)
    assert.deepEqual(foregroundSuppressedTurns({}, events), [])
    assert.deepEqual(session.surface.nodes.map(n => events[n].type), ['user/message', 'assistant/message'])
    assert.equal(events[session.surface.nodes.at(-1)].data.message.content[0].text, '门开了')
    assert.equal(events.slice(seq).filter(e => e.surfaceOp === 'append' && e.data.message?.content?.length).length, 0)
  }
})

test('撤销回退恢复带工具调用的轮次：工具结果占位与替换落在同一编辑步骤', () => {
  let session = Session.create('restore-tool-result')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  appendSessionEvent(session, 'step/start', { turn: 1, step: 1 })
  appendSessionEvent(session, 'user/message', { id: 'u', turn: 1, step: 1, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '推门' }] }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, stream: [], message: { id: 'a', role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'x', arguments: {} }], source: { kind: 'model', provider: 'test', model: 'test' } } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/result', { turn: 1, step: 1, message: { id: 'r', role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }], source: { kind: 'tool', callId: 'c1' } } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'step/end', { turn: 1, step: 1 })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const saved = [...session.surface.nodes]
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  appendSessionEvent(session, 'step/start', { turn: 2, step: 1 })
  appendSessionEvent(session, 'user/message', { id: 'rollback', turn: 2, step: 1, role: 'user', source: { kind: 'user' }, content: [] },
    { surfaceOp: { op: 'replace', start: saved[0], end: saved.at(-1) }, sourceEventSeqs: saved })
  appendSessionEvent(session, 'step/end', { turn: 2, step: 1 })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  preflightSurfaceRestore(session, saved)
  restoreSurface(session, saved)
  for (const reload of [false, true]) {
    if (reload) session = Session.create(session.id, sessionEvents(session), session.header)
    const events = sessionEvents(session)
    assert.deepEqual(session.surface.nodes.map(n => events[n].type), ['user/message', 'assistant/message', 'tool/result'])
    assert.equal(events[session.surface.nodes.at(-1)].data.message.content[0].text, 'ok')
  }
})
