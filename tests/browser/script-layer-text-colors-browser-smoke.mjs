// #305: a card script that touches the script layer hides the native prose; the
// layer must keep quote colors. Open ?mode=panels&trusted=1 (or comment/bracket) and
// read #result. Production projection + assistant renderer + installed DSH MarkdownText.
// No model, live chat, or card data. Run with esbuild on PATH and DSH_BROWSER_ROOT
// pointing to an installed DSH package (the directory containing node_modules).
import { createServer } from 'node:http'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { projectReplyLayers } from '../../tavern-plugin/lib/domain/reply-presentation.js'

if (!process.env.DSH_BROWSER_ROOT) throw Error('Set DSH_BROWSER_ROOT to the installed DSH package')
const require = createRequire(path.join(process.env.DSH_BROWSER_ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-primitives/package.json'))
const domRequire = createRequire(require.resolve('react-dom/client'))
const source = await readFile(new URL(new URL('../../tavern-plugin/lib/client.js', import.meta.url), import.meta.url), 'utf8')
const css = await readFile(new URL(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), import.meta.url), 'utf8')
const prose = '# 原生正文\n\n' + Array.from({ length: 35 }, (_, i) => `第 ${i + 1} 段：风吹过窗边，**她回过头**。这是一段用于检查正文中央滑动的文字。`).join('\n\n')
const panel = '<style>body{font:16px sans-serif}button{min-height:44px}</style><button id="status" onclick="this.textContent=\'状态已打开\'">查看状态</button><details><summary>展开说明</summary>卡片交互仍然有效</details>'
const F='```html\n<div style="padding:8px;border:1px solid #888">面板</div>\n```'
const cases = {
  bracket: '【说明】\n正文第一段。“台词一”',
  comment: '<!-- 说明 -->\n正文第一段。“台词一”',
  panels: '<!-- 风格锚定 -->\n正文一“台词一”\n\n'+F+'\n\n正文二“台词二”\n\n'+F+'\n\n正文三“台词三”',
}
const buildDir = await mkdtemp(path.join(tmpdir(), 'dsh-native-prose-build-'))
execFileSync('esbuild', ['--bundle', '--format=iife', '--outfile=' + path.join(buildDir, 'deps.js'),
  '--alias:react=' + path.dirname(domRequire.resolve('react')), '--define:process.env.NODE_ENV="production"',
  '--alias:react-dom=' + path.dirname(require.resolve('react-dom/package.json')),
  '--loader:.woff=dataurl', '--loader:.woff2=dataurl', '--loader:.ttf=dataurl', '--log-level=warning'], {
  input: `import * as React from ${JSON.stringify(domRequire.resolve('react'))};
import {createRoot} from ${JSON.stringify(require.resolve('react-dom/client'))};
import * as primitives from ${JSON.stringify(require.resolve('@deepseek-ai/dsh-client-ui-primitives'))};
window.fixture={React,createRoot};
window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?React:name==='@deepseek-ai/dsh-client-ui-primitives'?primitives:{});}};`,
  encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
})
const bundle = await readFile(path.join(buildDir, 'deps.js'))
const primitiveCss = await readFile(path.join(buildDir, 'deps.css'))
const runner = `const {React,createRoot}=window.fixture;
const slots={};client.createTavernAssistantRendererFeatureModule().register({
ctx:{effect(run,label){return label==='dsh-tavern: game script owner'?()=>{}:run();}},
slots:{inject:(_name,run)=>run(),register(spec,view){slots[spec.key]=view;return()=>{};}}});
const mode=new URL(location.href).searchParams.get('mode')||'mixed';
const cases=${JSON.stringify(cases)};
const props={sessionId:mode+(new URL(location.href).searchParams.get('trusted')==='1'?'|trusted':''),node:{data:{status:mode==='streaming'?'running':'completed',blocks:[{kind:'text',text:cases[mode]}],finalNode:{seq:1}},location:{kind:'turn',turn:{turn:1,status:'closed'}}},useTurnData:()=>null,fileMentions:()=>undefined};
createRoot(document.querySelector('#app')).render(React.createElement(slots['assistant-step'],props));
setTimeout(()=>{const visible=()=>Array.from(CSS.highlights.values()).flatMap(h=>Array.from(h).filter(r=>!r.startContainer.parentElement.closest('[hidden]')).map(r=>r.toString()));
const before=visible().length;for(const layer of document.querySelectorAll('[data-dsh-script-layer]'))layer.setAttribute('data-card-touched','');
setTimeout(()=>{const after=visible().length;document.querySelector('#result').textContent=before>0&&after===before?'PASS — 脚本层接管前后引号高亮 '+after+' 处':'FAIL before='+before+' after='+after;},200);},1500);`

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/deps.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle)
  if (url.pathname === '/deps.css') return res.writeHead(200, { 'Content-Type': 'text/css' }).end(primitiveCss)
  if (url.pathname === '/client.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(source)
  if (url.pathname === '/runner.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(runner)
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    const mode = ((body ? JSON.parse(body).sessionId : url.searchParams.get('sessionId')) || 'comment').split('|')[0]
    const layers = projectReplyLayers(cases[mode] || cases.comment)
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, view: {
      mode: 'story', card: { name: '渲染测试卡' }, tavernRuntimePolicy: { trustedCardMode: url.searchParams.get('trusted')==='1' || /trusted/.test(body) }, tavernHelper: { turnMessageIds: { '1': 1 } },
      replyProjections: [{ version: 2, turn: 1, mode: layers.displayMode, text: layers.displayText, parts: layers.displayParts }]
    } }))
  }
  if (url.pathname.endsWith('.css')) return res.writeHead(200, { 'Content-Type': 'text/css' }).end('')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>脚本层引号高亮验证</title>
<link rel="stylesheet" href="/deps.css"><style>${css}body{margin:0;font:16px/1.8 system-ui;color:#ddd;background:#17191d}#scroller{height:100dvh;overflow-y:auto;touch-action:pan-y;padding:16px;box-sizing:border-box}#app{max-width:760px;margin:auto}p{margin:18px 0}h1{font-size:24px}pre{white-space:pre-wrap}iframe{width:100%;border:0}</style>
<main id="scroller"><div id="app"></div><pre id="result">RUNNING</pre></main><script src="/deps.js"></script><script src="/client.js"></script><script src="/runner.js"></script>`)
})
server.listen(0, '127.0.0.1', () => console.log('SCRIPT_LAYER_COLORS_SMOKE_URL=http://127.0.0.1:' + server.address().port))
