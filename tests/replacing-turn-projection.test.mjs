import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStateView } from '../tavern-plugin/lib/domain/chat-session-state.js'

const events = [
  { seq: 0, type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
  { seq: 1, type: 'assistant/message', data: { turn: 1, message: { source: { kind: 'model', provider: 'p', model: 'm' } } } }
]
const session = { id: 's', events, surface: { nodes: [0, 1] } }
const fields = createSessionStateView({ activity: () => ({ busy: false }), evidence: () => ({ session, events }) })

function viewOf(chat) {
  return fields.rollback({ id: 'c', sessionId: 's', mode: 'story', messages: [], ...chat }, { session, events })
}

test('重生成只藏被替换的正文：replacingDshTurns 与 suppressedDshTurns 是两件事', () => {
  const view = viewOf({ replacingDshTurns: [2], suppressedDshTurns: [5] })
  assert.deepEqual(view.replacingDshTurns, [2])
  assert.deepEqual(view.suppressedDshTurns, [5])
})

test('同一回合不会同时出现在两个列表里，否则玩家输入会被连带隐藏', () => {
  const view = viewOf({ replacingDshTurns: [3], suppressedDshTurns: [3, 6] })
  assert.deepEqual(view.replacingDshTurns, [3])
  assert.deepEqual(view.suppressedDshTurns, [6])
})

test('中断在生成中的存档按恢复记录读回：重启后输入仍然可见', () => {
  const view = viewOf({ regenInProgress: true, regenRecovery: { id: 'op', temporaryReplacingTurn: 1 } })
  assert.deepEqual(view.replacingDshTurns, [1])
  assert.deepEqual(view.suppressedDshTurns, [])
})

test('没在重生成时，残留的恢复记录不再生效', () => {
  const view = viewOf({ suppressedDshTurns: [3], regenRecovery: { temporaryReplacingTurn: 1 } })
  assert.deepEqual(view.replacingDshTurns, [])
  assert.deepEqual(view.suppressedDshTurns, [3])
})

// 存档记的是生成期的合成回合，实际正文在提交之后才投影进另一个编辑回合。
// 视图必须以日志为准，否则旧回合会被当成当前正文继续显示。
const projectedEvents = [
  { seq: 0, type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
  { seq: 1, type: 'assistant/message', data: { turn: 1, message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '开场' }] } } },
  { seq: 2, type: 'assistant/message', data: { turn: 11, message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '被替换的正文' }] } } },
  { seq: 3, type: 'assistant/message', surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 }, sourceEventSeqs: [2],
    data: { turn: 12, message: { source: { kind: 'model', provider: 'p', model: 'm', tavernStoryTurn: 4 }, content: [{ type: 'text', text: '新正文' }] } } }
]
const projectedSession = { id: 's', events: projectedEvents, surface: { nodes: [0, 1, 3] } }

test('投影记在哪个原生回合，视图就指向哪个回合', () => {
  const view = fields.rollback({ id: 'c', sessionId: 's', mode: 'story', messages: [],
    regeneratedDshTurns: { 4: 11 }, suppressedDshTurns: [11] }, { session: projectedSession, events: projectedEvents })
  assert.equal(view.regeneratedDshTurns[4], 12, '存档里的 11 是生成期回合，正文实际在 12')
  assert.deepEqual(view.supersededDshTurns, [11], '旧回合的正文已被替换，页面不能再画')
})

test('没有投影时保持存档里的映射与空的待清理列表', () => {
  const view = viewOf({ regeneratedDshTurns: { 4: 11 } })
  assert.equal(view.regeneratedDshTurns[4], 11)
  assert.deepEqual(view.supersededDshTurns, [])
})
