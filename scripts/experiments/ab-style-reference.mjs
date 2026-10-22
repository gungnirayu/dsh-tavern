#!/usr/bin/env node
// 文风联想 A/B（逐轮对照）：同一存档导入一局，A 为不参考的主线。每轮先开启文风联想生成 B，
// 再关闭参考对这一轮重新生成得到 A，主线沿 A 继续。于是每轮的 A 与 B 前文完全相同，只差本轮是否注入参考。
//   node scripts/experiments/ab-style-reference.mjs --import 吞噬星空-前60轮.jsonl --card 吞噬星空 --inputs 输入.json --out 输出目录 [--home ~/.dsh-tavern]
// 输入文件是字符串数组，第一条是热身轮（只走主线，不对照）。对局保留不删；结果写入 <输出目录>/ab.json 与 ab.html（两栏并排）。
// 只按 ab.json 重新生成网页：node scripts/experiments/ab-style-reference.mjs --render-only --out 输出目录
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'

const args = process.argv.slice(2)
const option = name => { const at = args.indexOf('--' + name); return at >= 0 ? args[at + 1] : undefined }
const importFile = option('import'), cardName = option('card'), inputsFile = option('inputs'), outDir = option('out')
const renderOnly = args.includes('--render-only')
if (!outDir || !renderOnly && (!importFile || !cardName || !inputsFile)) {
  console.error('用法：node scripts/experiments/ab-style-reference.mjs --import 聊天记录.jsonl --card <人物卡名> --inputs 输入.json --out 输出目录 [--home DSH 主目录]')
  process.exit(1)
}
const home = path.resolve((option('home') || process.env.DSH_HOME || path.join(os.homedir(), '.dsh-tavern')).replace(/^~(?=$|\/)/, os.homedir()))
const tavern = path.join(home, 'profile-data', 'tavern')
const json = file => JSON.parse(readFileSync(file, 'utf8'))
mkdirSync(outDir, { recursive: true })

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
const textOf = content => (Array.isArray(content) ? content : []).map(block => block?.type === 'text' ? block.text || '' : '').join('\n')
const activity = async sessionId => (await rpc('getSessionActivity', { sessionId })).activity || {}

const escape = text => String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const paragraphs = text => String(text ?? '').split(/\n+/).filter(line => line.trim()).map(line => '<p>' + escape(line) + '</p>').join('')
function renderHtml({ card: name, sessionId, rows }) {
  const reference = row => row.B.injected
    ? `<div class="ref"><span class="src">B 本轮注入的文风联想 · ${escape(row.B.injected.source)}</span><blockquote>${paragraphs(row.B.injected.quote)}</blockquote></div>`
    : '<div class="ref none">B 本轮没有注入参考</div>'
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>文风联想 A/B</title><style>
:root{--bg:#faf8f4;--fg:#222;--muted:#777;--card:#fff;--line:#e4dfd6;--accent:#8a5a2b;--refbg:#f3ece1}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#e6e2da;--muted:#9a948a;--card:#242320;--line:#3a3732;--accent:#d7a46c;--refbg:#2d2a25}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.85 "Songti SC","Noto Serif SC",serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}.meta{color:var(--muted);font:13px/1.7 system-ui,sans-serif;margin-bottom:20px;word-break:break-all}
nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:24px;font-family:system-ui,sans-serif;font-size:13px}
nav a{color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:2px 10px}
section{margin-bottom:40px}h2{font:600 18px/1.4 system-ui,sans-serif;margin:0 0 8px}
.input{font-family:system-ui,sans-serif;font-size:14px;margin-bottom:10px}.input b{color:var(--accent)}
.ref{background:var(--refbg);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:15px}.ref.none{color:var(--muted);font:13px system-ui,sans-serif}
.ref .src{font:600 13px system-ui,sans-serif;color:var(--accent)}.ref blockquote{margin:4px 0 0;padding:0}.ref p{margin:0 0 .5em;text-indent:2em}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.col{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;min-width:0}
.col h3{font:600 14px system-ui,sans-serif;margin:0 0 6px;color:var(--muted)}.col p{margin:0 0 .8em;text-indent:2em}
@media (max-width:760px){.cols{grid-template-columns:1fr}}
</style></head><body><main>
<h1>文风联想 A/B · ${escape(name)}</h1>
<div class="meta">逐轮对照：每轮 A 与 B 的前文完全相同（主线沿 A 发展），只差 B 本轮注入了文风联想。<br>对局：${escape(sessionId)}</div>
<nav>${rows.map(row => `<a href="#t${row.index}">第 ${row.index} 轮</a>`).join('')}</nav>
${rows.map(row => `<section id="t${row.index}"><h2>第 ${row.index} 轮</h2>
<div class="input"><b>输入</b>　${escape(row.input)}</div>${reference(row)}
<div class="cols"><div class="col"><h3>A · 不参考（主线，${row.A.reply.length} 字）</h3>${paragraphs(row.A.reply)}</div>
<div class="col"><h3>B · 参考本轮（${row.B.reply.length} 字）</h3>${paragraphs(row.B.reply)}</div></div></section>`).join('\n')}
</main></body></html>`
}

if (renderOnly) {
  writeFileSync(path.join(outDir, 'ab.html'), renderHtml(json(path.join(outDir, 'ab.json'))))
  console.log('结果：' + path.join(outDir, 'ab.html'))
  process.exit(0)
}

const card = (await rpc('listCards', {})).cards.find(item => item.name === cardName || item.path === cardName)
if (!card) throw new Error('找不到人物卡：' + cardName)
const inputs = json(inputsFile)
const chatText = readFileSync(importFile, 'utf8')

async function waitIdle(sessionId, label) {
  const began = Date.now()
  for (let idle = 0; idle < 3;) {
    if (Date.now() - began > 600000) throw new Error(label + '：等待后台空闲超时')
    await sleep(2000)
    idle = (await activity(sessionId)).busy ? 0 : idle + 1
  }
}

async function setStyle(sessionId, on) {
  const config = await rpc('setConversationBackgroundConfig', { sessionId, backgroundTasks: { styleReference: on } })
  if (config.backgroundTasks.styleReference !== on) throw new Error('文风联想开关未生效')
}

// Turning the switch on recalls from the latest reply at once; wait for that operation to finish.
async function enableAndRecall(sessionId) {
  await waitIdle(sessionId, '开启参考前')
  const before = (await activity(sessionId)).operationId
  await setStyle(sessionId, true)
  const began = Date.now()
  for (;;) {
    if (Date.now() - began > 600000) throw new Error('等待文风联想超时')
    await sleep(2000)
    const now = await activity(sessionId)
    if (now.role === 'style-reference' && !now.busy && now.operationId !== before) {
      if (now.phase === 'failed') throw new Error('文风联想摘取失败')
      return
    }
  }
}

async function finishTurn(sessionId, start, label) {
  const began = Date.now()
  for (;;) {
    if (Date.now() - began > 900000) throw new Error(label + '：等待正文超时')
    await sleep(3000)
    const all = sessionEvents(sessionId)
    const end = all.findIndex((event, index) => index >= start && event.type === 'turn/end')
    if (end < 0) continue
    const turn = all.slice(start, end + 1)
    const reply = turn.filter(event => event.type === 'assistant/message').map(event => textOf(event.data.message?.content)).join('\n').trim()
    const injected = JSON.stringify(turn).match(/【文风联想 · ([^】]*)】\\n(.*?)\\n\\n/)
    return { reply, seconds: Math.round((Date.now() - began) / 1000), injected: injected ? { source: injected[1], quote: JSON.parse('"' + injected[2] + '"') } : null }
  }
}

const imported = await rpc('importChatHistoryText', { cardPath: card.path, text: chatText, fileName: 'AB-' + path.basename(importFile) })
const sessionId = imported.sessionId
console.log('对局：' + sessionId)
const rows = []
const save = () => {
  const result = { card: card.name, import: importFile, sessionId, rows }
  writeFileSync(path.join(outDir, 'ab.json'), JSON.stringify(result, null, 2))
  writeFileSync(path.join(outDir, 'ab.html'), renderHtml(result))
}
// A freshly imported game has no loaded session, so switching the reference on cannot recall yet.
// The first input is a warm-up on the mainline only; it opens the session and gives a reply to recall from.
const [warmup, ...turns] = inputs
const warmupStart = sessionEvents(sessionId).length
await rpc('sendPlayerInput', { sessionId, text: warmup })
const warm = await finishTurn(sessionId, warmupStart, '热身')
if (!warm.reply) throw new Error('热身轮没有正文')
console.log('热身轮完成')
await enableAndRecall(sessionId)
for (const [index, input] of turns.entries()) {
  // B: this turn with the reference recalled from the mainline's previous reply.
  let start = sessionEvents(sessionId).length
  await rpc('sendPlayerInput', { sessionId, text: input })
  const B = await finishTurn(sessionId, start, 'B')
  await setStyle(sessionId, false)
  await waitIdle(sessionId, 'B 结算')
  // A: regenerate the same turn without it; the mainline continues from A.
  start = sessionEvents(sessionId).length
  await rpc('regenBody', { sessionId, guidance: '' })
  const A = await finishTurn(sessionId, start, 'A')
  if (A.injected) throw new Error('A 不应带文风联想')
  rows.push({ index: index + 1, input, A, B })
  save()
  console.log(`第 ${index + 1} 轮  B ${B.seconds}s ${B.reply.length}字  A ${A.seconds}s ${A.reply.length}字  参考：${B.injected ? B.injected.source + '「' + B.injected.quote.slice(0, 40) + '…」' : '无'}`)
  if (index + 1 < turns.length) await enableAndRecall(sessionId)
}
console.log('结果：' + path.join(outDir, 'ab.html'))
