import test from 'node:test'
import assert from 'node:assert/strict'
import { foregroundWorldbookReads } from '../tavern-plugin/lib/domain/worldbook-read-handoff.js'
const read = (turn, id, entries, args = { refs: entries.map(e => e.ref) }, isError = false) => [
  { type: 'assistant/message', data: { turn, message: { content: [{ type: 'tool-call', name: 'worldbook_search', id, arguments: JSON.stringify(args) }] } } },
  { type: 'tool/result', data: { turn, message: { content: [{ type: 'tool-result', toolCallId: id, isError, content: [{ type: 'text', text: JSON.stringify({ mode: args.query && !args.read ? 'search' : 'read', ...(args.read ? {query:args.query} : {}), entries }) }] }] } } }
]
const entry = (ref, text) => ({ ref, title: ref, text, status: 'ok' })

test('rollback, regeneration and missing sessions never reuse another turn or background reads', () => {
  const session = { events: [...read(2, 'original', [entry('62', '旧正文')]), ...read(7, 'regenerated', [entry('62', '重生成正文')])] }
  assert.match(foregroundWorldbookReads({ messages: [{ role: 'assistant', turn: 2 }], regeneratedDshTurns: { 2: 7 } }, session), /重生成正文/)
  assert.equal(foregroundWorldbookReads({ messages: [{ role: 'assistant', turn: 1 }] }, session), '')
  assert.equal(foregroundWorldbookReads({ messages: [{ role: 'assistant', turn: 2 }] }, undefined), '')
})

test('DSH 0.2 tool messages (session v4) carry the read the same way as the 0.1.5 tool-result blocks', () => {
  const id = 'v4-read'
  const session = { events: [
    { type: 'assistant/message', data: { turn: 3, message: { content: [{ type: 'tool-call', name: 'worldbook_search', id, arguments: JSON.stringify({ refs: ['62'] }) }] } } },
    { type: 'tool/result', data: { turn: 3, message: { role: 'tool', toolCallId: id, isError: false, content: [{ type: 'text', text: JSON.stringify({ mode: 'read', entries: [entry('62', '钟楼的来历')] }) }] } } }
  ] }
  assert.match(foregroundWorldbookReads({ messages: [{ role: 'assistant', turn: 3 }] }, session), /钟楼的来历/)
})
