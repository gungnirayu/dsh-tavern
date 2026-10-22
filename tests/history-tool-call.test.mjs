import assert from 'node:assert/strict'
import test from 'node:test'
import { HISTORY_ANCHOR_TEXT, HISTORY_CALL_PREFIX, HISTORY_RECEIPT_TEXT, projectHistoryAsToolCalls } from '../tavern-plugin/lib/domain/history-tool-call.js'

function body(id, text) {
  return { id, role: 'assistant', source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text }] }
}

function player(id, text) {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

const TOOL = 'submit_story'

// These tests are about the projection itself; the anchor turn has its own tests below.
function project(messages, options) {
  const projected = projectHistoryAsToolCalls(messages, options)
  return projected === messages ? projected : projected.filter(message => !String(message.id).endsWith(':anchor'))
}

test('正文与玩家消息都改成提交调用，各自紧跟一条回执，文字只出现一次', () => {
  const messages = [
    player('player-1', '玩家输入'),
    body('message-1', '第一轮正文'),
    player('player-2', '继续')
  ]
  const projected = project(messages, { toolName: TOOL })
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
  assert.equal(project(messages, { toolName: TOOL }), messages)
})

test('多段文字合并进同一个 content 参数，保留原文换行', () => {
  const message = { id: 'message-2', role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'text', text: '第一段\n' }, { type: 'text', text: '第二段' }] }
  const [projected] = project([message], { toolName: TOOL })
  assert.equal(JSON.parse(projected.content[0].arguments).content, '第一段\n第二段')
})

test('调用标识由消息 id 推导，重复投影逐字节一致', () => {
  const messages = [body('message-3', '同样的正文')]
  const first = project(messages, { toolName: TOOL })
  const second = project(messages, { toolName: TOOL })
  assert.deepEqual(first, second)
  assert.ok(first[0].content[0].id.startsWith(HISTORY_CALL_PREFIX))
  // Different ids never collide.
  const other = project([body('message-4', '同样的正文')], { toolName: TOOL })
  assert.notEqual(first[0].content[0].id, other[0].content[0].id)
})

test('玩家消息用自己那条消息的 id 生成调用标识，与正文不串号', () => {
  const messages = [player('player-9', '玩家输入'), body('message-9', '玩家输入'), player('player-10', '继续')]
  const projected = project(messages, { toolName: TOOL })
  assert.notEqual(projected[0].content[0].id, projected[2].content[0].id)
  assert.ok(projected[0].content[0].id.startsWith(HISTORY_CALL_PREFIX))
  assert.ok(projected[2].content[0].id.startsWith(HISTORY_CALL_PREFIX))
})

test('调用标识能过网关：不超过 40 字符且只含 [A-Za-z0-9_-]', () => {
  const id = project([body('message-7', '正文')], { toolName: TOOL })[0].content[0].id
  assert.match(id, /^[A-Za-z0-9_-]{1,40}$/)
  // A long, exotic message id must not leak into the call id.
  const exotic = project([body('因为:session/中文?id=' + 'x'.repeat(200), '正文')], { toolName: TOOL })[0].content[0].id
  assert.match(exotic, /^[A-Za-z0-9_-]{1,40}$/)
})

test('preserve 指定的消息（本轮输入）不被改写，即使它后面还跟着帧', () => {
  const frame = { role: 'user', source: { kind: 'plugin:dsh-tavern' }, content: [{ type: 'text', text: '帧' }] }
  const messages = [player('player-1', '旧输入'), body('message-1', '正文'), player('player-2', '本轮输入'), frame]
  const projected = project(messages, {
    toolName: TOOL,
    preserve: message => message.id === 'player-2'
  })
  assert.deepEqual(projected.map(message => message.role), ['assistant', 'tool', 'assistant', 'tool', 'user', 'user'])
  assert.equal(projected[4].content[0].text, '本轮输入')
})

test('没有工具名或没有消息时原样返回', () => {
  const messages = [body('message-5', '正文')]
  assert.equal(project(messages, {}), messages)
  assert.equal(project(messages, { toolName: '' }), messages)
  assert.deepEqual(project([], { toolName: TOOL }), [])
  assert.equal(project(null, { toolName: TOOL }), null)
})

test('回执文本可覆盖，未提供时用默认值', () => {
  const [call, receipt] = project([body('message-6', '正文')], { toolName: TOOL, receipt: '已保存' })
  assert.equal(call.content[0].type, 'tool-call')
  assert.deepEqual(receipt.content, [{ type: 'text', text: '已保存' }])
})

test('bodies 布局只回放正文，玩家消息保持 user 轮次', () => {
  const messages = [player('player-1', '玩家输入'), body('message-1', '第一轮正文'), player('player-2', '继续')]
  const projected = project(messages, { toolName: TOOL, layout: 'bodies' })
  assert.deepEqual(projected.map(message => message.role), ['user', 'assistant', 'tool', 'user'])
  assert.equal(projected[0].content[0].text, '玩家输入')
})

test('all 布局把说明性文本也改成调用，系统提示仍是 system', () => {
  const frame = { id: 'frame-1', role: 'user', source: { kind: 'plugin:dsh-tavern' }, content: [{ type: 'text', text: '共同创作虚构小说' }] }
  const system = { id: 'system', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: '规则' }] }
  const messages = [system, frame, body('message-1', '正文'), player('player-2', '继续')]
  const projected = project(messages, { toolName: TOOL, layout: 'all' })
  assert.deepEqual(projected.map(message => message.role), ['system', 'assistant', 'tool', 'assistant', 'tool', 'user'])
  assert.deepEqual(JSON.parse(projected[1].content[0].arguments), { content: '共同创作虚构小说' })
})

test('everything 布局连本轮输入一起回放，末尾是一条回执', () => {
  const messages = [body('message-1', '正文'), player('player-2', '继续')]
  const projected = project(messages, { toolName: TOOL, layout: 'everything' })
  assert.deepEqual(projected.map(message => message.role), ['assistant', 'tool', 'assistant', 'tool'])
  assert.equal(projected.at(-1).role, 'tool')
  assert.deepEqual(JSON.parse(projected[2].content[0].arguments), { content: '继续' })
})

test('json 布局是纯文本对照：同样的 JSON 走 user 轮次，没有回执', () => {
  const messages = [body('message-1', '正文'), player('player-2', '继续')]
  const projected = project(messages, { toolName: TOOL, layout: 'json' })
  assert.deepEqual(projected.map(message => message.role), ['user', 'user'])
  assert.deepEqual(JSON.parse(projected[0].content[0].text), { content: '正文' })
})

test('echo 布局的回执重复正文，其余与 story 一致', () => {
  const messages = [body('message-1', '正文'), player('player-2', '继续')]
  const projected = project(messages, { toolName: TOOL, layout: 'echo' })
  assert.deepEqual(projected.map(message => message.role), ['assistant', 'tool', 'user'])
  assert.deepEqual(projected[1].content, [{ type: 'text', text: '正文' }])
})

test('只由正文组成的历史（导入的旧存档从开场白开始）：开头的调用前补一条固定的 user 轮次（#330）', () => {
  const instruction = { id: 'frame', role: 'user', source: { kind: 'plugin:dsh-tavern' }, content: [{ type: 'text', text: '框架指令' }] }
  const imported = [body('greeting', '开场白'), player('player-1', '我推开门'), body('message-1', '门开了'), player('input', '继续')]
  const projected = projectHistoryAsToolCalls(imported, { toolName: TOOL })
  assert.deepEqual(projected.map(message => message.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'user'])
  assert.deepEqual(projected[0].content, [{ type: 'text', text: HISTORY_ANCHOR_TEXT }])
  assert.equal(projected[0].id, projected[1].content[0].id + ':anchor')
  assert.deepEqual(projectHistoryAsToolCalls(imported, { toolName: TOOL }), projected, '逐字节稳定，缓存照样命中')
  // 每个调用前面都是 user 轮次或工具结果：严格的 Gemini 渠道接受。
  projected.forEach((message, index) => {
    if (message.role === 'assistant') assert.ok(['user', 'tool'].includes(projected[index - 1].role))
  })

  // 开头已有指令（原生局每轮都有框架指令）：请求与原来一致，不补。
  const native = projectHistoryAsToolCalls([instruction, ...imported], { toolName: TOOL })
  assert.equal(native.some(message => String(message.id).endsWith(':anchor')), false)
})

test('调用前面是一条没改写的 assistant（带思维链等）时也补；system 不算前一轮', () => {
  const thinking = { id: 'thinking', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'reasoning', text: '想' }, { type: 'text', text: '正文' }] }
  const system = { id: 'system', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: '规则' }] }
  const projected = projectHistoryAsToolCalls([system, thinking, body('message-1', '下一段'), player('input', '继续')], { toolName: TOOL })
  assert.deepEqual(projected.map(message => message.role), ['system', 'assistant', 'user', 'assistant', 'tool', 'user'])
  assert.equal(projected[2].content[0].text, HISTORY_ANCHOR_TEXT)
})
