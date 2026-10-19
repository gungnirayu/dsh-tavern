import assert from 'node:assert/strict'
import test from 'node:test'
import { HISTORY_CALL_PREFIX, HISTORY_RECEIPT_TEXT, projectHistoryAsToolCalls } from '../tavern-plugin/lib/domain/history-tool-call.js'

function body(id, text) {
  return { id, role: 'assistant', source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text }] }
}

function player(id, text) {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

const TOOL = 'submit_story'

test('正文与玩家消息都改成提交调用，各自紧跟一条回执，文字只出现一次', () => {
  const messages = [
    player('player-1', '玩家输入'),
    body('message-1', '第一轮正文'),
    player('player-2', '继续')
  ]
  const projected = projectHistoryAsToolCalls(messages, { toolName: TOOL })
  // 最后一条玩家消息是本轮要回答的问题，必须保持原样。
  assert.deepEqual(projected.map(message => message.role), ['assistant', 'tool', 'assistant', 'tool', 'user'])
  const inputCall = projected[0]
  assert.equal(inputCall.role, 'assistant', '玩家消息作为调用时由 assistant 发出')
  assert.equal(inputCall.id, 'player-1')
  assert.deepEqual(JSON.parse(inputCall.content[0].arguments), { content: '玩家输入' })
  assert.equal(projected[1].toolCallId, inputCall.content[0].id)
  const replyCall = projected[2]
  assert.equal(replyCall.id, 'message-1')
  assert.deepEqual(replyCall.content.map(block => block.type), ['tool-call'])
  assert.equal(replyCall.content[0].name, TOOL)
  assert.deepEqual(JSON.parse(replyCall.content[0].arguments), { content: '第一轮正文' })
  const receipt = projected[3]
  // DSH 0.2 (session v4) sends a tool result as a first-class tool message.
  assert.equal(receipt.role, 'tool')
  assert.deepEqual(receipt.source, { kind: 'tool', callId: replyCall.content[0].id })
  assert.equal(receipt.toolCallId, replyCall.content[0].id)
  assert.equal(receipt.isError, false)
  assert.deepEqual(receipt.content, [{ type: 'text', text: HISTORY_RECEIPT_TEXT }])
  // 正文（模型与玩家各一段）都只出现在参数里一次。
  const json = JSON.stringify(projected)
  assert.equal(json.split('第一轮正文').length - 1, 1)
  assert.equal(json.split('玩家输入').length - 1, 1)
  // 原数组不被修改。
  assert.equal(messages.length, 3)
})

test('插件注入、思维链、已有工具回合与空消息保持原样', () => {
  const plugin = { role: 'assistant', source: { kind: 'plugin:dsh-tavern' }, content: [{ type: 'text', text: '插件注入' }] }
  const pluginUser = { role: 'user', source: { kind: 'plugin:dsh-tavern' }, content: [{ type: 'text', text: '规则' }] }
  const reasoned = { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'reasoning', text: '思考' }, { type: 'text', text: '正文' }] }
  const native = { role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'tool-call', id: 'c1', name: TOOL, arguments: '{"content":"已有"}' }] }
  const empty = { role: 'assistant', source: { kind: 'model' }, content: [] }
  const blank = { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '   ' }] }
  const system = { role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: '系统' }] }
  const messages = [plugin, pluginUser, reasoned, native, empty, blank, system]
  assert.equal(projectHistoryAsToolCalls(messages, { toolName: TOOL }), messages)
})

test('多段文字合并进同一个 content 参数，保留原文换行', () => {
  const message = { id: 'message-2', role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'text', text: '第一段\n' }, { type: 'text', text: '第二段' }] }
  const [projected] = projectHistoryAsToolCalls([message], { toolName: TOOL })
  assert.equal(JSON.parse(projected.content[0].arguments).content, '第一段\n第二段')
})

test('调用标识由消息 id 推导，重复投影逐字节一致', () => {
  const messages = [body('message-3', '同样的正文')]
  const first = projectHistoryAsToolCalls(messages, { toolName: TOOL })
  const second = projectHistoryAsToolCalls(messages, { toolName: TOOL })
  assert.deepEqual(first, second)
  assert.ok(first[0].content[0].id.startsWith(HISTORY_CALL_PREFIX))
  // Different ids never collide.
  const other = projectHistoryAsToolCalls([body('message-4', '同样的正文')], { toolName: TOOL })
  assert.notEqual(first[0].content[0].id, other[0].content[0].id)
})

test('玩家消息用自己那条消息的 id 生成调用标识，与正文不串号', () => {
  const messages = [player('player-9', '玩家输入'), body('message-9', '玩家输入'), player('player-10', '继续')]
  const projected = projectHistoryAsToolCalls(messages, { toolName: TOOL })
  assert.notEqual(projected[0].content[0].id, projected[2].content[0].id)
  assert.ok(projected[0].content[0].id.startsWith(HISTORY_CALL_PREFIX))
  assert.ok(projected[2].content[0].id.startsWith(HISTORY_CALL_PREFIX))
})

test('调用标识能过网关：不超过 40 字符且只含 [A-Za-z0-9_-]', () => {
  const id = projectHistoryAsToolCalls([body('message-7', '正文')], { toolName: TOOL })[0].content[0].id
  assert.match(id, /^[A-Za-z0-9_-]{1,40}$/)
  // A long, exotic message id must not leak into the call id.
  const exotic = projectHistoryAsToolCalls([body('因为:session/中文?id=' + 'x'.repeat(200), '正文')], { toolName: TOOL })[0].content[0].id
  assert.match(exotic, /^[A-Za-z0-9_-]{1,40}$/)
})

test('preserve 指定的消息（本轮输入）不被改写，即使它后面还跟着帧', () => {
  const frame = { role: 'user', source: { kind: 'plugin:dsh-tavern' }, content: [{ type: 'text', text: '帧' }] }
  const messages = [player('player-1', '旧输入'), body('message-1', '正文'), player('player-2', '本轮输入'), frame]
  const projected = projectHistoryAsToolCalls(messages, {
    toolName: TOOL,
    preserve: message => message.id === 'player-2'
  })
  assert.deepEqual(projected.map(message => message.role), ['assistant', 'tool', 'assistant', 'tool', 'user', 'user'])
  assert.equal(projected[4].content[0].text, '本轮输入')
})

test('没有工具名或没有消息时原样返回', () => {
  const messages = [body('message-5', '正文')]
  assert.equal(projectHistoryAsToolCalls(messages, {}), messages)
  assert.equal(projectHistoryAsToolCalls(messages, { toolName: '' }), messages)
  assert.deepEqual(projectHistoryAsToolCalls([], { toolName: TOOL }), [])
  assert.equal(projectHistoryAsToolCalls(null, { toolName: TOOL }), null)
})

test('回执文本可覆盖，未提供时用默认值', () => {
  const [call, receipt] = projectHistoryAsToolCalls([body('message-6', '正文')], { toolName: TOOL, receipt: '已保存' })
  assert.equal(call.content[0].type, 'tool-call')
  assert.deepEqual(receipt.content, [{ type: 'text', text: '已保存' }])
})
