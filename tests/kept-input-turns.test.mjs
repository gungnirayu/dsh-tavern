import test from 'node:test'
import assert from 'node:assert/strict'
import { keptPlayerInputTurns } from '../tavern-plugin/lib/domain/rollback-surface.js'

const model = { kind: 'model', provider: 'p', model: 'm' }
const start = turn => ({ type: 'turn/start', data: { turn } })
const end = (turn, kind = 'completed') => ({ type: 'turn/end', data: { turn, reason: { kind } } })
const human = text => ({ type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const plugin = text => ({ type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin:dsh-tavern-regen' }, content: [{ type: 'text', text }] } })
const body = (turn, text) => ({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: { source: model, content: [{ type: 'text', text }] } } })
function log(...items) { return items.map((event, seq) => ({ ...event, seq })) }

// 失败的一轮：玩家输入后没有正文，随后重试在另一个原生回合写出正文。
function failedThenRetry() {
  return log(start(1), human('第一句'), body(1, '第一段'), end(1),
    start(2), human('第二句'), end(2, 'error'),
    start(3), plugin('第二句'), body(3, 'Pass'), end(3))
}

test('失败回合的输入被重试正文采用时，保留玩家输入那一轮', () => {
  assert.deepEqual(keptPlayerInputTurns({ events: failedThenRetry(), replyTurns: [3], suppressed: [2, 3] }), [2])
})

test('没有后续正文时，作废失败轮的输入照常隐藏', () => {
  assert.deepEqual(keptPlayerInputTurns({ events: failedThenRetry(), replyTurns: [1], suppressed: [2] }), [])
})

test('玩家已经发下一条后，不再保留更早失败轮的输入', () => {
  const events = log(start(1), human('第一句'), body(1, '第一段'), end(1),
    start(2), human('第二句'), end(2, 'error'),
    start(3), human('第三句'), body(3, '第三段'), end(3))
  assert.deepEqual(keptPlayerInputTurns({ events, replyTurns: [3], suppressed: [2] }), [])
})

test('生成中的重试还没有正文时，按当前这一轮保留最近一次玩家输入', () => {
  const events = log(...failedThenRetry(), start(4), end(4, 'error'))
  assert.deepEqual(keptPlayerInputTurns({ events, replyTurns: [4], suppressed: [2], openTurn: 4 }), [2])
})

test('触发卡和内部上下文不算玩家输入', () => {
  const events = log(start(1), human('第一句'), body(1, '第一段'), end(1),
    start(2), human('第二句'), end(2, 'error'),
    start(3), plugin('第二句'), { type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin:dsh-tavern' }, content: [{ type: 'text', text: '内部指令' }] } },
    body(3, 'Pass'), end(3))
  assert.deepEqual(keptPlayerInputTurns({ events, replyTurns: [3], suppressed: [2] }), [2])
})
