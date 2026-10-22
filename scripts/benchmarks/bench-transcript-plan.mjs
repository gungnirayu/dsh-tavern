#!/usr/bin/env node
// Synthetic long games (every 5th round regenerated): the row plan's per-turn cost —
// compute plus view-sync delta — must not grow with the game. No model, no app.
//   node scripts/benchmarks/bench-transcript-plan.mjs
const R = new URL('../../tavern-plugin/lib/domain/', import.meta.url).href
const { planTranscriptWindow } = await import(R + 'transcript-row-plan.js')
const { createSessionViewSync } = await import(R + 'session-view-sync.js')
const model = { kind: 'model', provider: 'test', model: 'test' }
const mark = (seq, type, turn) => ({ seq, type, data: { turn, step: 1, reason: { kind: 'completed' } } })
const text = t => [{ type: 'text', text: t }]
function game(rounds) {
  const events = [], save = []
  let turn = 0
  const push = e => events.push({ ...e, seq: events.length })
  function round(index) {
    const own = ++turn, start = events.length
    push(mark(0, 'turn/start', own)); push({ type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: text('行动'), source: { kind: 'user' } } })
    push({ type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: text('上下文'), source: { kind: 'plugin', plugin: 'dsh-tavern' } } })
    push({ type: 'assistant/message', surfaceOp: 'append', data: { turn: own, step: 1, message: { role: 'assistant', content: text('正文' + index), source: model } } })
    push(mark(0, 'step/end', own)); push(mark(0, 'turn/end', own))
    save.push({ role: 'user', text: '行动' }, { role: 'assistant', turn: own, text: '正文' + index })
    if (index % 5 === 0) {
      const attempt = ++turn, edit = ++turn
      push(mark(0, 'turn/start', attempt)); push({ type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: text('重新生成'), source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } } })
      const reply = events.length
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn: attempt, step: 1, message: { role: 'assistant', content: text('新' + index), source: model } } })
      push(mark(0, 'step/end', attempt)); push(mark(0, 'turn/end', attempt))
      push(mark(0, 'turn/start', edit))
      push({ type: 'assistant/message', surfaceOp: { op: 'replace', start: start + 3, end: reply }, data: { turn: edit, step: 1, message: { role: 'assistant', content: text('新' + index), source: { ...model, tavernStoryTurn: own } } } })
      push(mark(0, 'step/end', edit)); push(mark(0, 'turn/end', edit))
    }
  }
  for (let index = 1; index <= rounds; index++) round(index)
  return { events, save, round }
}
function counted(events) {
  const box = { reads: 0 }
  box.proxy = new Proxy(events, { get(t, k, r) { if (typeof k === 'string' && /^\d+$/.test(k)) box.reads++; return Reflect.get(t, k, r) } })
  return box
}
const rows = []
for (const rounds of [400, 4000, 40000]) {
  const g = game(rounds)
  const sync = createSessionViewSync()
  let cursor = sync('s', { transcriptTurns: planTranscriptWindow({ messages: g.save.slice(-48), events: g.events, partial: true }).turns }, null).viewCursor
  const times = [], reads = [], bytes = []
  for (let turn = 0; turn < 30; turn++) {
    g.round(rounds + turn + 1)
    const box = counted(g.events)
    const t = performance.now()
    const plan = planTranscriptWindow({ messages: g.save.slice(-48), events: box.proxy, partial: true })
    const result = sync('s', { transcriptTurns: plan.turns, transcriptFrom: plan.from }, cursor)
    times.push(performance.now() - t); reads.push(box.reads)
    cursor = result.viewCursor
    bytes.push(JSON.stringify(result.viewDelta || result.view).length)
  }
  const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
  rows.push({ 轮数: rounds, 日志事件: g.events.length, '每轮计算+同步(ms,中位)': +median(times).toFixed(3), '每轮访问事件(中位)': median(reads), '每轮同步增量(字节,中位)': median(bytes) })
}
console.table(rows)
