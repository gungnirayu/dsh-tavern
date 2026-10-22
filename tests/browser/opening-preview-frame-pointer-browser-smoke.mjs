// 卡内脚本（外置小手机）初始化时会把自己所在的 iframe 设成 pointer-events:none。
// 开场预览的 iframe 就是页面本身，这里固定住样式契约：可见帧始终可点击，
// 隐藏的待替换帧和准备中的预览仍不接收点击。
// node tests/browser/opening-preview-frame-pointer-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<!doctype html><meta charset="utf-8"><style>' + css + '</style>'
  + '<div class="dsh-tavern-card-picker"><div class="dsh-tavern-greeting-preview" id="preview">'
  + '<div class="dsh-tavern-message-frame-slot">'
  + '<iframe class="dsh-tavern-message-frame" id="visible"></iframe>'
  + '<iframe class="dsh-tavern-message-frame" aria-hidden="true" id="hidden"></iframe>'
  + '</div></div></div>')

// 每次先按卡内脚本的写法覆盖内联样式，再看层叠后的结果。
const probe = () => page.evaluate(() => {
  for (const frame of document.querySelectorAll('iframe')) frame.style.pointerEvents = 'none'
  const pointer = id => getComputedStyle(document.getElementById(id)).pointerEvents
  return { visible: pointer('visible'), hidden: pointer('hidden') }
})

assert.deepEqual(await probe(), { visible: 'auto', hidden: 'none' }, '可见预览帧保持可点击，隐藏帧不拦截')
await page.evaluate(() => document.getElementById('preview').setAttribute('data-dsh-tavern-preview-busy', 'true'))
assert.deepEqual(await probe(), { visible: 'none', hidden: 'none' }, '准备中的预览仍不接收点击')
await browser.close()
console.log('PASS 开场预览帧的点击不被卡内脚本关闭')
