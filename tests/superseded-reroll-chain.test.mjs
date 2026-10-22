import test from 'node:test'
import assert from 'node:assert/strict'
import { supersededRegenerationTurns } from '../tavern-plugin/lib/domain/rollback-surface.js'

const text = value => ({ content: [{ type: 'text', text: value }] })
const append = (turn, body) => ({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: { source: { kind: 'model' }, ...text(body) } } })
const replace = (turn, body, range, sources, story) => ({ type: 'assistant/message', surfaceOp: { op: 'replace', startSeq: range[0], endSeq: range[1] }, sourceEventSeqs: sources,
  data: { turn, step: 1, message: { source: { kind: 'model', ...(story ? { tavernStoryTurn: story } : {}) }, ...text(body) } } })

// 三次 reroll 的写入链：每次投影只直接引用上一份投影，旧提交副本（turn 3 / 5）
// 要通过更早的投影才能找到。最新投影仍在页面上时，它们不能被画出来。
const events = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'user' }, ...text('输入') } },
  append(1, '旧正文'), { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'turn/start', data: { turn: 2 } },
  { type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin:dsh-tavern-regen' }, ...text('输入') } },
  append(2, 'A'), replace(2, 'A', [6, 6], [6]),
  { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  { type: 'turn/start', data: { turn: 3 } }, append(3, 'A'), replace(3, 'A', [2, 10], [2, 6, 7, 10], 9),
  { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
  { type: 'turn/start', data: { turn: 4 } },
  { type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin:dsh-tavern-regen' }, ...text('输入') } },
  append(4, 'B'), replace(4, 'B', [15, 15], [15]),
  { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } },
  { type: 'turn/start', data: { turn: 5 } }, append(5, 'B'), replace(5, 'B', [11, 19], [11, 15, 16, 19], 9),
  { type: 'turn/end', data: { turn: 5, reason: { kind: 'completed' } } },
  { type: 'turn/start', data: { turn: 6 } },
  { type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin:dsh-tavern-regen' }, ...text('输入') } },
  append(6, 'C'), replace(6, 'C', [24, 24], [24]),
  { type: 'turn/end', data: { turn: 6, reason: { kind: 'completed' } } },
  { type: 'turn/start', data: { turn: 7 } }, append(7, 'C'), replace(7, 'C', [20, 28], [20, 24, 25, 28], 9),
  { type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } }
].map((event, seq) => ({ ...event, seq }))

test('第三次 reroll 之后，前两次提交留下的正文副本也进入隐藏名单', () => {
  const latest = events.findLast(event => event.surfaceOp?.op === 'replace')
  const superseded = supersededRegenerationTurns({ events, nodes: [latest.seq], keepTurns: [7] })
  assert.deepEqual(superseded, [1, 2, 3, 4, 5, 6], '旧正文、旧提交副本和生成期回合都藏；最新第 7 轮保留')
})
