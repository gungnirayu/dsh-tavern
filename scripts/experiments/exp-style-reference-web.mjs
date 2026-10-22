#!/usr/bin/env node
// 文风联想：凭记忆（不联网）与联网搜索对照。每份样本导入两份副本，各自为最新一段正文选一次段
// （这一轮还没有参考，不带「上一次选的是」），记录书名、作者、原文、耗时与搜索次数。
//   node scripts/experiments/exp-style-reference-web.mjs --card <人物卡名> --out 输出目录 样本1.jsonl [样本2.jsonl …]
// 联网组运行期间临时改写系统提示词「文风联想选段」，结束（含出错）后恢复原值。对局保留不删。
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'

const args = process.argv.slice(2)
const option = name => { const at = args.indexOf('--' + name); return at >= 0 ? args[at + 1] : undefined }
const cardName = option('card'), outDir = option('out')
const samples = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'))
if (!cardName || !outDir || !samples.length) {
  console.error('用法：node scripts/experiments/exp-style-reference-web.mjs --card <人物卡名> --out 输出目录 样本.jsonl …')
  process.exit(1)
}
const home = path.join(os.homedir(), '.dsh-tavern'), tavern = path.join(home, 'profile-data', 'tavern')
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

// Search-first variant for the web group; the rest matches the default prompt.
const WEB_PROMPT = `你是文风联想员，不续写剧情，不修改变量。
阅读刚写完的正文，判断它的题材、场景、情绪和笔调；找一部笔调与之最接近的已出版小说，从中摘抄一段与当前场景气质相近的原文，约 100～300 字。

先用 web_search 搜索：按正文的题材和笔调找候选作品，再搜能看到原文的页面（在线阅读、书摘、引文），用搜索结果核对摘抄的文字。搜索不超过 4 次。

选书：
- 跟着正文的题材和笔调选，不必是名家名作。轻小说、网络小说和各类类型小说（言情、武侠、仙侠、悬疑、科幻、奇幻、恐怖、校园、日常等）都可以。
- 正文轻快、日常、对话多，就找同样轻快的作品；正文沉重、文气重，才找文学性强的作品。

要求：
- 摘叙事或描写段落：人物的动作、神态、对话，环境与细节。不要名言警句、议论抒情或格言式的句子。
- 只摘中文白话：中文小说或外国小说的通行中译本，不要外文原文，不要文言。
- 必须是搜索结果里能看到、或用搜索核对过的原作文字，不要仿写、改写或拼接；核对不了就换一段能核对的。

最后调用 style_reference_submit 提交书名、作者和这段原文。`

function backgroundSearches(since) {
  // Background sessions touched since the recall started; count web_search calls in them.
  let searches = 0, queries = []
  for (const project of readdirSync(path.join(tavern, 'sessions'))) {
    const dir = path.join(tavern, 'sessions', project)
    for (const id of readdirSync(dir)) {
      if (!id.startsWith('background-')) continue
      const logs = readdirSync(path.join(dir, id)).filter(name => /^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(name)).sort()
      const file = logs.length && path.join(dir, id, logs.at(-1))
      if (!file || statSync(file).mtimeMs < since) continue
      for (const event of parseSessionLog(readFileSync(file)).events) {
        if (!(event.time >= since) || event.type !== 'assistant/message') continue
        for (const block of event.data?.message?.content || []) {
          if (block?.type !== 'tool_use' && block?.type !== 'tool-call' && block?.type !== 'toolCall') continue
          if (String(block.name) !== 'web_search') continue
          searches++
          queries.push(JSON.stringify(block.input ?? block.arguments ?? '').slice(0, 120))
        }
      }
    }
  }
  return { searches, queries }
}

async function recall(file, web) {
  const card = (await rpc('listCards', {})).cards.find(item => item.name === cardName || item.path === cardName)
  if (!card) throw new Error('找不到人物卡：' + cardName)
  const imported = await rpc('importChatHistoryText', { cardPath: card.path, text: readFileSync(file, 'utf8'), fileName: (web ? 'WEB-' : 'MEM-') + path.basename(file) })
  const sessionId = imported.sessionId
  // Settings first: the game is not open yet, so enabling starts no recall of its own.
  await rpc('setConversationBackgroundConfig', { sessionId, webSearchEnabled: web, backgroundTasks: { styleReference: true } })
  const started = Date.now()
  let reference = null, failed = null
  try { reference = (await rpc('retryStyleReference', { sessionId })).styleReference } catch (error) { failed = String(error.message || error) }
  const view = (await rpc('getSession', { sessionId })).view
  const replies = (view?.tavernHelper?.messages || []).filter(message => !message.is_user)
  return { sample: path.basename(file), web, sessionId, ms: Date.now() - started, reference, failed,
    reply: String(replies.at(-1)?.message || '').slice(-1200), ...backgroundSearches(started) }
}

const original = (await rpc('getSystemPrompts', {})).systemPrompts.prompts.find(item => item.name === 'style-reference-recall')
if (!original) throw new Error('当前运行的酒馆没有「文风联想选段」系统提示词，请先同步本地代码')
const rows = []
try {
  for (const file of samples) {
    rows.push(await recall(file, false))
    console.log('不联网', path.basename(file), rows.at(-1).reference?.book || rows.at(-1).failed)
    await rpc('updateSystemPrompt', { name: 'style-reference-recall', text: WEB_PROMPT })
    try { rows.push(await recall(file, true)) }
    finally { await rpc('updateSystemPrompt', { name: 'style-reference-recall', text: original.text }) }
    console.log('联网', path.basename(file), rows.at(-1).reference?.book || rows.at(-1).failed, '搜索', rows.at(-1).searches)
    writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(rows, null, 2))
  }
} finally {
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(rows, null, 2))
}
console.log('结果：' + path.join(outDir, 'results.json'))
