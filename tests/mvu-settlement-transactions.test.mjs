import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementTransactions } from '../tavern-plugin/lib/domain/mvu-settlement-transactions.js'
import { projectTavernHelperContext } from '../tavern-plugin/lib/domain/tavern-helper-context.js'

const input = { sessionId: 's', operationId: 'op', messageId: 0, swipeId: 0, expectedLifecycleRevision: 2, command: '<UpdateVariable/>' }
function harness(dispatch) {
  const chat = { id: 'c', sessionId: 's', mvu: { enabled: true }, tavernHelperLifecycleRevision: 2,
    messages: [{ role: 'assistant', text: '正文', swipeId: 0, swipes: ['正文'], variables: [{ stat_data: { hp: 10 }, schema: {} }] }] }
  const transactions = createMvuSettlementTransactions({ resolveChat: async () => structuredClone(chat),
    context: async (_id, draft = chat) => projectTavernHelperContext(draft), readGlobalVariables: async () => ({ shared: true }),
    scriptDispatch: { dispatch: (...args) => dispatch(transactions, ...args) } })
  return { transactions, chat }
}
test('事务接口隔离草稿、保护正文和共享变量，拒绝后释放归属与迟到写入', async () => {
  let eventId
  const { transactions, chat } = harness(async (tx, _session, _name, _args, _context, work) => {
    eventId = work.eventId
    assert.equal(tx.has('s'), true)
    await assert.rejects(tx.settle(input), /已有 MVU/)
    assert.throws(() => tx.assertEvent('s', 'other'), { code: 'MVU_SETTLEMENT_EVENT_MISMATCH' })
    const patches = await tx.prepareMessages('s', [{ message_id: 0, message: '内部指令' }], eventId)
    assert.equal(patches[0].message, undefined)
    await tx.touchMessage('s', 0, eventId)
    const draft = await tx.mutationChat('s', eventId)
    draft.messages[0].variables[0].stat_data.hp = 9
    await assert.rejects(tx.updateGlobals('s', { shared: false }), /跨对话/)
    assert.equal((await tx.updateGlobals('s', { shared: true, extra_analysis: true })).transactional, true)
    assert.equal((await tx.result('s', { type: 'message', messageId: 0 }, false, eventId)).transactional, true)
    return { handled: true }
  })
  const result = await transactions.settle({ ...input, validate: () => ({ failures: [{ message: 'reject' }] }) })
  assert.equal(result.rejected, true)
  assert.equal(chat.messages[0].variables[0].stat_data.hp, 10)
  assert.equal(transactions.has('s'), false)
  await assert.rejects(transactions.mutationChat('s', eventId), { code: 'MVU_SETTLEMENT_EVENT_MISMATCH' })
})
test('执行异常释放事务，下一次结算可重新进入', async () => {
  let calls = 0
  const { transactions } = harness(async () => { if (++calls === 1) throw new Error('executor failed'); return { handled: true } })
  await assert.rejects(transactions.settle(input), /executor failed/)
  assert.equal(transactions.has('s'), false)
  assert.equal((await transactions.settle(input)).updated, true)
  assert.equal(transactions.has('s'), false)
})
