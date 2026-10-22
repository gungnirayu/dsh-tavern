import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const context = vm.createContext({})
vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/src/client/modules/auto-open-tabs.js', import.meta.url), 'utf8'), context)
const cleared = context.tavernAutoOpenClearedBy
const blankMs = context.TAVERN_AUTO_OPEN_BLANK_MS

test('会话列表刷新读不到当前会话时，不清「这一局已展示过」的记号', () => {
  // 宿主刷新列表、侧栏重挂载的那几帧 current 是空串；把它当成离开会让同一局再弹一次状态页。
  assert.equal(cleared('session-a', ''), false)
  assert.equal(cleared('session-a', undefined), false)
  assert.equal(cleared('session-a', null), false)
})

test('同一局一直是当前会话时不清记号', () => {
  assert.equal(cleared('session-a', 'session-a'), false)
})

test('真的切到另一局才清记号', () => {
  assert.equal(cleared('session-a', 'session-b'), true)
  assert.equal(cleared('', 'session-b'), true)
})

test('空串要越过抖动窗口才算离开', () => {
  assert.ok(blankMs >= 500, `blank window too short: ${blankMs}`)
})

const showsPage = context.tavernRightColumnShowsPage
const kinds = ['dsh-tavern:conversation-settings', 'dsh-tavern:status']
const column = (expanded, page) => ({ isExpanded: () => expanded, active: () => page })

test('右栏收起时不算「已经在看」，仍要按进入游戏打开', () => {
  assert.equal(showsPage(column(false, { kind: 'dsh-tavern:status' }), kinds), false)
})

test('右栏已展开且停在状态页上时不重复打开，避免把面板压到正文', () => {
  assert.equal(showsPage(column(true, { kind: 'dsh-tavern:status' }), kinds), true)
  assert.equal(showsPage(column(true, { contentId: 'dsh-tavern:status' }), kinds), true)
  assert.equal(showsPage(column(true, { kind: 'dsh-tavern:conversation-settings' }), kinds), true)
})

test('右栏展开但在别的页面上时照常打开', () => {
  assert.equal(showsPage(column(true, { kind: 'files' }), kinds), false)
  assert.equal(showsPage(column(true, undefined), kinds), false)
})

test('宿主没有右栏控制器或调用抛错时不阻断自动打开', () => {
  assert.equal(showsPage(null, kinds), false)
  assert.equal(showsPage({}, kinds), false)
  assert.equal(showsPage({ isExpanded: () => { throw new Error('boom') }, active: () => null }, kinds), false)
})

test('从 ctx 取右栏控制器，服务缺失或抛错都按「没在看」处理', () => {
  const showing = context.tavernRightColumnShowing
  assert.equal(showing({ get: () => column(true, { kind: 'dsh-tavern:status' }) }, kinds), true)
  assert.equal(showing({ get: () => undefined }, kinds), false)
  assert.equal(showing({ get: () => { throw new Error('no service') } }, kinds), false)
  assert.equal(showing(null, kinds), false)
})

test('构建产物带上了同一套判定', () => {
  const bundle = fs.readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /function tavernAutoOpenClearedBy\(/)
  assert.match(bundle, /function tavernRightColumnShowsPage\(/)
  assert.match(bundle, /tavernAutoOpenClearedBy\(tavernSettingsTabsShownFor, current\)/)
  // 旧判定：非空之外的一切（含空串）都算离开，正是这次修掉的回归。
  assert.doesNotMatch(bundle, /if \(current !== tavernSettingsTabsShownFor\) tavernSettingsTabsShownFor = "";/)
})
