// A background rewind appends a surface replacement at the tail of an
// append-only log. Released V4 reads that position, so the replacement needs the
// turn and step open *there*: writing it after the previous task closed its turn
// produced "assistant/message does not match an open turn and step" and the whole
// background archive stopped loading.
import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { rewindBackgroundSurface } from '../tavern-plugin/lib/domain/background-surface.js'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

const HEADER = { type: 'session', version: 4, id: 'session-rewind-fixture', createdAt: 1, cwd: 'C:/tmp', isSeeded: false, delegationDepth: 0, agentPreset: 'tavern-background' }
const MODEL = { kind: 'model', provider: 'fixture', model: 'fixture' }

function createSession({ open }) {
  const events = []
  const session = { header: HEADER, id: HEADER.id, events, surface: { nodes: [] }, append(type, data, options = {}) {
    const seq = events.length
    events.push({ seq, type, data, ...options })
    const nodes = session.surface.nodes
    if (options.surfaceOp?.op === 'replace') {
      const startSeq = options.surfaceOp.startSeq ?? options.surfaceOp.start
      const endSeq = options.surfaceOp.endSeq ?? options.surfaceOp.end
      const start = nodes.indexOf(startSeq), end = nodes.indexOf(endSeq)
      assert.ok(start >= 0 && end >= start, 'replacement range must be on the surface')
      nodes.splice(start, end - start + 1, seq)
    } else if (options.surfaceOp === 'append') nodes.push(seq)
    return seq
  } }
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('system/message', { turn: 1, step: 1, message: { id: 'tavern-system-head:' + HEADER.id, role: 'system', content: [], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
  session.append('user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: '第一问' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '第一答' }], source: MODEL } }, { surfaceOp: 'append' })
  if (open) { session.append('turn/start', { turn: 2 }); session.append('step/start', { turn: 2, step: 1 }) }
  else { session.append('step/end', { turn: 1, step: 1 }); session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) }
  return session
}

const turns = events => events.filter(event => event.type === 'turn/start').map(event => event.data.turn)
const replacement = events => events.filter(event => event.surfaceOp?.op === 'replace').at(-1)

test('rewind after a closed turn opens its own turn for the replacement and closes it', () => {
  const session = createSession({ open: false })
  const agent = { phase: { kind: 'idle', lastTurn: 1 } }
  assert.equal(rewindBackgroundSurface(session, 0, agent), 2)
  const events = sessionEvents(session)
  const appended = events.slice(-5).map(event => event.type)
  assert.deepEqual(appended, ['turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end'])
  assert.deepEqual(turns(events), [1, 2])
  const written = replacement(events)
  assert.equal(written.data.turn, 2)
  assert.equal(written.data.step, 1)
  assert.deepEqual(written.sourceEventSeqs, [3, 4])
  // The Agent numbers its next turn from what it can read: publish the edit turn.
  assert.equal(agent.phase.lastTurn, 2)
  assert.deepEqual(session.surface.nodes, [2, written.seq])
})

test('rewind inside an open turn reuses it and adds no turn of its own', () => {
  const session = createSession({ open: true })
  const agent = { phase: { kind: 'idle', lastTurn: 1 } }
  const opened = turns(sessionEvents(session))
  assert.equal(rewindBackgroundSurface(session, 0, agent), 2)
  const events = sessionEvents(session)
  assert.deepEqual(turns(events), opened)
  const written = replacement(events)
  assert.equal(written.data.turn, 2)
  assert.equal(written.data.step, 1)
  assert.equal(events.at(-1).type, 'assistant/message')
  assert.equal(agent.phase.lastTurn, 1)
})

// The unit shape above only stays honest while the released validator accepts it.
test('rewound archive satisfies the released V4 relationship contract', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async () => {
  const session = createSession({ open: false })
  rewindBackgroundSurface(session, 0, { phase: { kind: 'idle', lastTurn: 1 } })
  const { assertReleasedV4Relationships } = await import(
    new URL('../../dsh-session-format-v3-to-v4/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const events = sessionEvents(session)
  assertReleasedV4Relationships(
    { header: session.header, events, inheritedEventCount: 0 },
    new Set(events.map(event => event.type)))
})
