import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('trusted inline prose installs quote highlights and releases them on replacement/unmount', { skip: !process.env.TAVERN_BROWSER_TESTS }, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<style>body{color:rgb(30,30,30);--dsw-alias-brand-primary:blue}</style><div id="root"></div>')
  const sources = await Promise.all(['text-colors.js', 'inline-fragment.js'].map(file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')))
  await page.addScriptTag({ content: `
    const React = {useRef:()=>({current:document.querySelector('#root')}), useLayoutEffect:fn=>{window.cleanup=fn()}, createElement(){}};
    function bindTavernFontZoom(){return ()=>{}}
    ${sources.join('\n')}
    window.mount = content => TavernInlineFragment({content});
    window.ranges = () => [...CSS.highlights.values()].flatMap(h=>[...h].map(r=>r.toString()));
  ` })
  await page.evaluate(() => mount('<p>她说：“你好。”</p><pre>“代码”</pre><p style="color:red">“卡片颜色”</p>'))
  // Wait for the highlighter's batched refresh, then inspect actual browser ranges.
  await page.waitForTimeout(100)
  assert.deepEqual(await page.evaluate(() => ranges()), ['“你好。”'])
  await page.evaluate(() => { cleanup(); mount('<p>“新的段落。”</p>') })
  await page.waitForTimeout(100)
  assert.deepEqual(await page.evaluate(() => ranges()), ['“新的段落。”'])
  await page.evaluate(() => cleanup())
  assert.equal(await page.evaluate(() => CSS.highlights.size), 0)
  assert.equal(await page.locator('[data-dsh-tavern-text-colors]').count(), 0)
  assert.equal(await page.locator('#root').textContent(), '')
})

test('every message shares one stylesheet and four named highlights per document', { skip: !process.env.TAVERN_BROWSER_TESTS }, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<style>body{color:rgb(30,30,30)}</style>' + Array.from({ length: 30 }, (_, i) => `<p id="m${i}">她说：“第${i}句。”</p>`).join(''))
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/src/client/text-colors.js', import.meta.url), 'utf8') + `
    window.ranges = () => [...CSS.highlights.values()].flatMap(h=>[...h].map(r=>r.toString()));
    window.views = Array.from(document.querySelectorAll('p'), p => installTavernTextColors(p, {}, findTavernQuoteRanges));
  ` })
  await page.waitForFunction(() => window.ranges().length === 30)
  assert.deepEqual(await page.evaluate(() => ({ names: CSS.highlights.size, styles: document.querySelectorAll('style[data-dsh-tavern-text-colors]').length })), { names: 4, styles: 1 })
  // A refresh or dispose of one message must leave the other messages' ranges alone.
  await page.evaluate(() => { document.querySelector('#m1').firstChild.data = '没有引号'; window.views[2].dispose() })
  await page.waitForFunction(() => window.ranges().length === 28)
  assert.equal((await page.evaluate(() => window.ranges())).includes('“第0句。”'), true)
  await page.evaluate(() => window.views.forEach(view => view.dispose()))
  assert.deepEqual(await page.evaluate(() => ({ names: CSS.highlights.size, styles: document.querySelectorAll('style[data-dsh-tavern-text-colors]').length })), { names: 0, styles: 0 })
})

test('page-root layout changes do not re-read every message; a theme change does', { skip: !process.env.TAVERN_BROWSER_TESTS }, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<style>body{color:rgb(30,30,30)} html.dark body{color:rgb(220,220,220)}</style>' + Array.from({ length: 5 }, (_, i) => `<p>“第${i}句。”</p>`).join(''))
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/src/client/text-colors.js', import.meta.url), 'utf8') + `
    window.walks = 0; const walker = document.createTreeWalker; document.createTreeWalker = function (...args) { window.walks++; return walker.apply(this, args) };
    window.ranges = name => CSS.highlights.get(name)?.size || 0;
    Array.from(document.querySelectorAll('p'), p => installTavernTextColors(p, {}, findTavernQuoteRanges));
  ` })
  await page.waitForFunction(() => window.ranges('dsh-tavern-text-quote-light') === 5)
  const settle = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
  await page.evaluate(() => { window.walks = 0; document.documentElement.style.setProperty('--layout-height', '220px'); document.body.style.setProperty('--font', '18px') })
  await settle()
  assert.equal(await page.evaluate(() => window.walks), 0)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.waitForFunction(() => window.ranges('dsh-tavern-text-quote-dark') === 5)
  assert.equal(await page.evaluate(() => window.walks), 5)
})
