import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { planTranscriptRows } from '../tavern-plugin/lib/domain/transcript-row-plan.js'
import { keptPlayerInputTurns } from '../tavern-plugin/lib/domain/rollback-surface.js'

const model = { kind: 'model', provider: 'p', model: 'm' }
const start = turn => ({ type: 'turn/start', data: { turn } })
const end = (turn, kind = 'completed') => ({ type: 'turn/end', data: { turn, reason: { kind } } })
const human = text => ({ type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const plugin = text => ({ type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin:dsh-tavern-regen' }, content: [{ type: 'text', text }] } })
const body = (turn, text) => ({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: { source: model, content: [{ type: 'text', text }] } } })
const log = (...items) => items.map((event, seq) => ({ ...event, seq }))

// 失败的一轮：玩家输入后没有正文，随后重试在另一个原生回合写出正文。存档只有两轮，
// 第二轮的正文挂在第 3 个原生轮上；第 2 个原生轮只剩玩家那句话和失败残留。
const events = log(start(1), human('第一句'), body(1, '第一段'), end(1),
  start(2), human('第二句'), end(2, 'error'),
  start(3), plugin('第二句'), body(3, 'Pass'), end(3))
const chat = { messages: [{ role: 'user', text: '第一句' }, { role: 'assistant', turn: 1 },
  { role: 'user', text: '第二句' }, { role: 'assistant', turn: 3 }] }

test('重试采用失败轮的输入时，计划只留玩家那一行', () => {
  const keepInput = keptPlayerInputTurns({ events, replyTurns: [1, 3], suppressed: [2, 3] })
  assert.deepEqual(keepInput, [2])
  const plan = planTranscriptRows({ chat, events, keepInput })
  // 第 2 轮只画输入；失败残留、触发卡和尾行都不画。
  assert.deepEqual(plan['2'], { input: 1, reply: 0, kept: 1 })
})

test('页面按计划隐藏：玩家输入留下，错误、触发卡与尾行收起', async () => {
  const keepInput = keptPlayerInputTurns({ events, replyTurns: [1, 3], suppressed: [2, 3] })
  const plan = planTranscriptRows({ chat, events, keepInput })
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<main></main>')
    const result = await page.evaluate(({ source, turns }) => {
      window.__ModuleLoader__ = { load(definition) { window.client = definition.factory(() => ({})) } }
      window.eval(source)
      const root = document.querySelector('main')
      const projection = client.createTurnHistoryProjection({ root: () => root, storage: () => ({ getItem: () => '{}', setItem() {} }) })
      function row(turn, kind, text) {
        const node = document.createElement('div')
        node.setAttribute('data-chat-flow-kind', kind)
        if (turn !== null) node.setAttribute('data-chat-turn', String(turn))
        node.textContent = text
        root.append(node)
        return node
      }
      const rows = {
        first: row(1, 'user', '第一句'),
        firstBody: row(1, 'assistant-step', '第一段'),
        firstTail: row(1, 'turn-tail', ''),
        input: row(2, 'user', '第二句'),
        context: row(2, 'context', '失败清理'),
        strayTrigger: row(2, 'turn-trigger', '收到执行请求'),
        tail: row(2, 'turn-tail', ''),
        body: row(3, 'assistant-step', 'Pass'),
        bodyTail: row(3, 'turn-tail', '')
      }
      const hidden = node => getComputedStyle(node).display === 'none'
      projection.apply('s', { turns, from: null }, [])
      const state = {}
      for (const [key, node] of Object.entries(rows)) state[key] = hidden(node)
      return state
    }, { source, turns: plan })
    assert.deepEqual(result, {
      first: false, firstBody: false, firstTail: false,
      input: false, context: true, strayTrigger: true, tail: true,
      body: false, bodyTail: false
    }, '玩家输入留下，其余作废残留仍然藏')
  } finally { await browser.close() }
})

test('没有保留名单时，失败轮的输入照常藏起来', () => {
  const plan = planTranscriptRows({ chat, events, keepInput: [] })
  assert.deepEqual(plan['2'], { input: 0, reply: 0 })
})
