import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

async function loadClient() {
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(clientSource, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadClient()

function makeWindow(pagehide) {
  const target = new EventTarget()
  const win = {
    CustomEvent,
    Event,
    document: target,
    addEventListener(name, fn) { if (name === 'pagehide' && pagehide) pagehide.push(fn); else target.addEventListener(name, fn) },
    removeEventListener(name, fn) { target.removeEventListener(name, fn) },
  }
  win.parent = win
  win.top = win
  return win
}

function buildPreviewScript() {
  const document = client.buildTavernFrameDocument({
    token: 'relay-token',
    content: '<button>选择开场</button>',
    openingPreview: { swipes: ['开场'], openingIds: ['primary'], selectedIndex: 0, preparationId: 'draft' }
  })
  return document.match(/<script data-dsh-tavern-opening-preview>([\s\S]*?)<\/script>/)[1]
}

function runPreviewScript() {
  const pagehide = []
  const parentWin = makeWindow(), frameWin = makeWindow(pagehide)
  frameWin.parent = parentWin
  frameWin.top = parentWin
  vm.runInNewContext(buildPreviewScript(), {
    window: frameWin, parent: parentWin, document: frameWin.document,
    addEventListener: (name, fn) => frameWin.addEventListener(name, fn),
    removeEventListener: (name, fn) => frameWin.removeEventListener(name, fn),
    setTimeout, clearTimeout, console,
  })
  return { parentWin, frameWin, pagehide }
}

test('开场预览把面板派发到宿主文档的确认事件同步中继进预览文档', async () => {
  const { parentWin, frameWin } = runPreviewScript()
  const received = []
  frameWin.document.addEventListener('hc1:opening-confirm', event => {
    event.detail.result = Promise.resolve('已检票上车。')
    received.push(event.detail)
  })
  const packet = { chatId: 'c1', target: 1, text: '身份' }
  parentWin.document.dispatchEvent(new CustomEvent('hc1:opening-confirm', { detail: packet }))
  assert.equal(received.length, 1)
  assert.ok(packet.result, 'packet.result 必须在同步派发中被赋值')
})

test('中继过滤 dsh- 前缀与无对象 detail 的事件，释放后停止中继', () => {
  const { parentWin, frameWin, pagehide } = runPreviewScript()
  const received = []
  frameWin.document.addEventListener('hc1:opening-confirm', event => received.push(event.detail))
  parentWin.document.dispatchEvent(new CustomEvent('dsh-tavern-internal', { detail: { x: 1 } }))
  parentWin.document.dispatchEvent(new CustomEvent('plain-detail'))
  parentWin.document.dispatchEvent(new Event('no-detail'))
  assert.deepEqual(received, [])
  parentWin.document.dispatchEvent(new CustomEvent('hc1:opening-confirm', { detail: { chatId: 'c1' } }))
  assert.equal(received.length, 1)
  for (const handler of pagehide) handler()
  parentWin.document.dispatchEvent(new CustomEvent('hc1:opening-confirm', { detail: { chatId: 'c2' } }))
  assert.equal(received.length, 1, '释放后不再中继')
  const descriptor = Object.getOwnPropertyDescriptor(parentWin.document, 'dispatchEvent')
  assert.ok(!descriptor || descriptor.value === EventTarget.prototype.dispatchEvent, '释放后还原宿主 dispatchEvent')
})
