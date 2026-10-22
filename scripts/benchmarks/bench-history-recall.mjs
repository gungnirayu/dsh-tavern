#!/usr/bin/env node
// Memory-recall benchmark: does the model look things up in the story's history, and does it help?
//   node scripts/benchmarks/bench-history-recall.mjs (--import 吞噬星空-前60轮.jsonl --card 吞噬星空 | --save 已压缩.dshsave) --quiz 题库.json
//     [--form ask|hint|probe|both，默认 ask] [--repeat 1] [--only 1,5,9] [--out 结果.jsonl] [--home ~/.dsh-tavern] [--keep]
// Every question gets a fresh game, the same start every time: the chat file imported anew (no model,
// no compaction: the whole story may still be in context), or a frozen save — e.g. one compacted once —
// imported anew. One player input is sent and the turn is read back from the session log.
// --form ask puts the question off-stage without hinting at recall (does the model look things up?);
// hint asks it to check the story's history first (once it looks, does it find it?); probe sends the item's in-story line.
// Per answer it records: the recalls made, whether any recall result held the answer, whether the reply
// held it. Quiz items: { id, question, probe, keywords: [["809"], ["杨武", "杨哥"]] } — every group must
// match, any word within a group counts. Optional decoyKeywords (same shape) spot a reply that took a
// near-miss fact from the summary for the answer. The game is deleted afterwards unless --keep.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'

const args = process.argv.slice(2)
const option = name => { const at = args.indexOf('--' + name); return at >= 0 ? args[at + 1] : undefined }
const importFile = option('import'), cardName = option('card'), saveFile = option('save'), quizFile = option('quiz')
if (!(importFile && cardName || saveFile) || !quizFile) {
  console.error('用法：node scripts/benchmarks/bench-history-recall.mjs (--import 聊天记录.jsonl --card <人物卡名> | --save 存档.dshsave) --quiz 题库.json [--form ask|probe|both] [--repeat 次数] [--only 1,5,9] [--out 结果.jsonl] [--home DSH 主目录，默认 ~/.dsh-tavern] [--keep]')
  process.exit(1)
}
const home = path.resolve((option('home') || process.env.DSH_HOME || path.join(os.homedir(), '.dsh-tavern')).replace(/^~(?=$|\/)/, os.homedir()))
const tavern = path.join(home, 'profile-data', 'tavern')
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const forms = { ask: ['ask'], hint: ['hint'], probe: ['probe'], both: ['ask', 'probe'] }[option('form') || 'ask']
if (!forms) throw new Error('--form 只能是 ask、hint、probe 或 both')
const repeat = Math.max(1, Number(option('repeat')) || 1)
const only = option('only') ? new Set(option('only').split(',').map(Number)) : null
const quiz = json(quizFile).filter(item => !only || only.has(Number(item.id)))
const outFile = option('out')
const origin = saveFile ? { fileB64: readFileSync(saveFile).toString('base64') } : { text: readFileSync(importFile, 'utf8') }

function rpc(method, payload) {
  const { port } = json(path.join(home, 'logs', 'tavern.pid.json'))
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/dsh-tavern/' + method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk }).on('end', () => {
        let value
        try { value = JSON.parse(text) } catch { return reject(new Error(method + ' 返回：' + text.slice(0, 300))) }
        value.ok === false ? reject(new Error(method + ' 失败：' + (value.error || text.slice(0, 300)))) : resolve(value)
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

function sessionEvents(id) {
  for (const project of readdirSync(path.join(tavern, 'sessions'))) {
    const directory = path.join(tavern, 'sessions', project, id)
    if (!existsSync(directory)) continue
    const generations = readdirSync(directory).filter(name => /^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(name)).sort()
    if (generations.length) return parseSessionLog(readFileSync(path.join(directory, generations.at(-1)))).events
  }
  return []
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const has = (text, item) => item.keywords.every(group => group.some(word => text.includes(word)))
const textOf = content => (Array.isArray(content) ? content : []).map(block => block?.text || '').join('\n')
const card = saveFile ? null : (await rpc('listCards', {})).cards.find(item => item.name === cardName || item.path === cardName)
if (!saveFile && !card) throw new Error('找不到人物卡：' + cardName)

async function play(item, form) {
  const imported = saveFile ? await rpc('importGameSave', origin)
    : await rpc('importChatHistoryText', { cardPath: card.path, text: origin.text, fileName: path.basename(importFile) })
  const sessionId = imported.sessionId
  const chatId = json(path.join(tavern, 'data', 'sessions.json'))[sessionId]
  try {
    const start = sessionEvents(sessionId).length
    const question = item.question.replace(/[？?]$/, '')
    const input = form === 'ask' ? `（场外提问，不要续写剧情）请直接简短回答：${question}？`
      : form === 'hint' ? `（场外提问，不要续写剧情）请先用历史检索查原文核实，再简短回答：${question}？` : item.probe
    const began = Date.now()
    await rpc('sendPlayerInput', { sessionId, text: input })
    let turn
    while (!turn) {
      if (Date.now() - began > 600000) throw new Error('等待模型回复超时')
      await sleep(3000)
      const all = sessionEvents(sessionId)
      const end = all.findIndex((event, index) => index >= start && event.type === 'turn/end')
      if (end >= 0) turn = all.slice(start, end + 1)
    }
    const results = new Map(turn.filter(event => event.type === 'tool/result').map(event => [event.data.message?.toolCallId, textOf(event.data.message?.content)]))
    const recalls = turn.filter(event => event.type === 'tool/call' && event.data?.name === 'tavern_recall_history').map(event => {
      let input = {}
      try { input = JSON.parse(event.data.arguments) } catch {}
      return { ...input, hit: has(results.get(event.data.callId) || '', item) }
    })
    // Score the reply only, not the model's reasoning.
    const reply = turn.filter(event => event.type === 'assistant/message').map(event => textOf((event.data.message.content || []).filter(block => block?.type === 'text'))).join('\n').trim()
    // The whole turn as the model lived it, for reading by hand: reasoning, recalls and what they returned.
    const transcript = turn.flatMap(event => {
      if (event.type === 'assistant/message') return (event.data.message.content || []).map(block => ({ [block.type]: block.text })).filter(entry => Object.values(entry)[0])
      if (event.type === 'tool/call') return [{ call: event.data.name, arguments: event.data.arguments }]
      if (event.type === 'tool/result') return [{ result: textOf(event.data.message?.content) }]
      return []
    })
    return { id: item.id, form, input, recalls, recallHit: recalls.some(recall => recall.hit), correct: has(reply, item), decoy: !has(reply, item) && Array.isArray(item.decoyKeywords) && has(reply, { keywords: item.decoyKeywords }), reply, seconds: Math.round((Date.now() - began) / 1000), transcript }
  } finally {
    if (!args.includes('--keep') && chatId) await rpc('deleteChats', { chatIds: [chatId] }).catch(error => console.warn('删除测试对话失败：' + error.message))
  }
}

const rows = []
for (let round = 1; round <= repeat; round++) {
  for (const item of quiz) {
    for (const form of forms) {
      let row
      try { row = await play(item, form) } catch (error) { row = { id: item.id, form, error: error.message } }
      rows.push(row)
      if (outFile) appendFileSync(outFile, JSON.stringify({ round, ...row }) + '\n')
      if (row.error) { console.log(`  ${String(item.id).padStart(2)} ${form}  出错：${row.error}`); continue }
      const recalls = row.recalls.map(recall => (recall.query ? '「' + recall.query + '」' : '第 ' + recall.turn + ' 轮') + (recall.hit ? '✓' : '✗')).join(' ')
      console.log(`  ${String(item.id).padStart(2)} ${form.padEnd(5)} ${row.correct ? '答对' : row.decoy ? '答成诱饵' : '答错'}  ${recalls ? '检索 ' + recalls : '未检索'}  ${row.seconds}s  —— ${item.question}`)
      console.log('        ' + row.reply.replace(/\s+/g, ' ').slice(0, 140))
    }
  }
}

console.log('\n汇总：')
for (const form of forms) {
  const done = rows.filter(row => row.form === form && !row.error)
  if (!done.length) continue
  const rate = list => list.length ? `${list.filter(row => row.correct).length}/${list.length}` : '—'
  const called = done.filter(row => row.recalls.length), silent = done.filter(row => !row.recalls.length)
  console.log(`  ${form}：${done.length} 次，检索 ${called.length} 次（结果含答案 ${called.filter(row => row.recallHit).length}），答对 ${rate(done)}；检索过的答对 ${rate(called)}，没检索的答对 ${rate(silent)}`)
}
