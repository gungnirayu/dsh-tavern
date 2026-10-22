import assert from 'node:assert/strict'
import test from 'node:test'
import { helperClient } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('生产通信模块校验窗口与token，拒绝伪造回复并在更新上下文后完成请求', async () => {
  let receive, eventId = 'event-1', scriptId = 'script-1'
  const sent = [], contexts = [], events = []
  const parent = { postMessage: message => sent.push(message) }
  const transport = helperClient.createTavernHelperTransport({ parent, token: 'secret', copy: structuredClone,
    identity: () => ({ eventId, scriptId }), listen: listener => { receive = listener },
    onContext: value => contexts.push(value), onEvent: value => events.push(value) })
  const args = { values: { count: 1 } }
  let settled = false
  const result = transport.request('updateVariables', args).then(value => { settled = true; assert.equal(contexts.length, 1); return value })
  args.values.count = 7
  assert.equal(sent[0].args.values.count, 1)
  assert.equal(sent[0].eventId, 'event-1')
  assert.equal(sent[0].scriptId, 'script-1')
  const response = { type: 'dsh-tavern-helper-response', token: 'secret', requestId: sent[0].requestId, ok: true, result: { context: { revision: 3 } } }
  receive({ source: {}, data: response })
  receive({ source: parent, data: { ...response, token: 'wrong' } })
  await tick(); assert.equal(settled, false); assert.equal(contexts.length, 0)
  receive({ source: parent, data: response })
  assert.deepEqual(await result, response.result)
  receive({ source: parent, data: response })
  assert.equal(contexts.length, 1, '重复回复不再次应用上下文')
  receive({ source: parent, data: { type: 'dsh-tavern-helper-event', token: 'wrong' } })
  assert.equal(events.length, 0)
  receive({ source: parent, data: { type: 'dsh-tavern-helper-event', token: 'secret', name: 'MESSAGE_SENT' } })
  assert.equal(events[0].name, 'MESSAGE_SENT')
  eventId = 'event-2'; scriptId = 'script-2'
  const failed = transport.request('write', {})
  assert.equal(sent[1].eventId, eventId); assert.equal(sent[1].scriptId, scriptId)
  const rejection = assert.rejects(failed, /revision conflict/)
  receive({ source: parent, data: { ...response, requestId: sent[1].requestId, ok: false, error: 'revision conflict' } })
  await rejection
})

test('上下文同步未完成时探测照常应答、事件仍等待；同步失败给出明确失败回执', async () => {
  let receive, release, fail
  const sent = [], events = []
  const parent = { postMessage: message => sent.push(message) }
  helperClient.createTavernHelperTransport({ parent, token: 't', copy: structuredClone, identity: () => ({}),
    listen: listener => { receive = listener }, onEvent: value => events.push(value.type),
    onContext: () => new Promise((resolve, reject) => { release = resolve; fail = reject }) })
  const message = (type, extra) => receive({ source: parent, data: { token: 't', type: 'dsh-tavern-helper-' + type, eventId: 'e1', ...extra } })
  message('context')
  message('event', { name: 'CHAT_CHANGED', args: [1] })
  message('event-query'); message('event-ack'); message('event-query', { eventId: 'lost' })
  await tick()
  assert.deepEqual(events, ['dsh-tavern-helper-event-ack', 'dsh-tavern-helper-event-query'], '只有事件本身等待上下文')
  assert.deepEqual(sent.map(x => [x.type, x.phase]), [['dsh-tavern-helper-event-state', 'queued']], '排队中的事件回报存活，不触发重发')
  release(); await tick()
  assert.equal(events.at(-1), 'dsh-tavern-helper-event')

  message('context'); message('event', { eventId: 'e2', args: [2] })
  fail(new Error('读取失败')); await tick()
  const receipt = sent.at(-1)
  assert.equal(receipt.type, 'dsh-tavern-helper-event-complete')
  assert.equal(receipt.eventId, 'e2')
  assert.equal(receipt.errorCode, 'TAVERN_HELPER_CONTEXT_FAILED')
  assert.match(receipt.error, /读取失败/)
  assert.equal(events.filter(x => x === 'dsh-tavern-helper-event').length, 1, '没有上下文不执行处理器')
})
