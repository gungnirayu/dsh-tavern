import assert from 'node:assert/strict'
import test from 'node:test'

import { projectRegenerationRequestMessages } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

function player(text, id = '') {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function body(text) {
  return { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } }
}

function frame(text = '规则') {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-tavern' } }
}

function regenerate(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }
}

test('重新生成保留它之前的所有楼层，只替换被重采样的那次输入', () => {
  const messages = [player('第一轮输入', 'p1'), body('第一轮正文'), player('第二轮输入', 'p2'), frame(), regenerate('重新生成第二轮')]
  const projected = projectRegenerationRequestMessages(messages)
  assert.equal(projected.length, 3)
  assert.equal(projected[1].content[0].text, '第一轮正文')
  // 原玩家消息的身份保留，只有内容换成这次重采样的投影文本。
  assert.equal(projected[2].id, 'p2')
  assert.equal(projected[2].content[0].text, '重新生成第二轮')
})

test('上一轮没有落地正文时，不会退到更早的输入并把中间楼层一起丢掉', () => {
  // 目标轮（第二轮）的回复因为报错/中断没有成为消息：它前面最近的 assistant 是
  // 第一轮的正文。旧实现从那条 assistant 往回找输入，会把第二轮输入连同第一轮
  // 正文一起裁掉，模型于是收到一份没有任何历史的请求。
  const messages = [player('第一轮输入', 'p1'), body('第一轮正文'), player('第二轮输入', 'p2'), frame(), regenerate('重新生成第二轮')]
  messages.splice(1, 0, player('第一轮补充', 'p0'))
  const projected = projectRegenerationRequestMessages(messages)
  assert.deepEqual(projected.map(message => message.role), ['user', 'user', 'assistant', 'user'])
  assert.equal(projected[2].content[0].text, '第一轮正文')
  assert.equal(projected[3].content[0].text, '重新生成第二轮')
  // 第一轮的输入与正文都还在。
  assert.deepEqual(projected.slice(0, 2).map(message => message.content[0].text), ['第一轮输入', '第一轮补充'])
})

test('没有可替换的玩家输入或没有重采样输入时原样返回', () => {
  const noPlayer = [body('正文'), regenerate('重新生成')]
  assert.equal(projectRegenerationRequestMessages(noPlayer), noPlayer)
  const noRegenerate = [player('输入'), body('正文')]
  assert.equal(projectRegenerationRequestMessages(noRegenerate), noRegenerate)
  assert.deepEqual(projectRegenerationRequestMessages([]), [])
  assert.deepEqual(projectRegenerationRequestMessages(null), [])
})

test('被重采样那一轮的旧回复与旧帧一并丢弃', () => {
  const messages = [player('输入', 'p1'), body('旧回复'), frame('旧帧'), regenerate('重新生成')]
  const projected = projectRegenerationRequestMessages(messages)
  assert.deepEqual(projected.map(message => message.content[0].text), ['重新生成'])
})
