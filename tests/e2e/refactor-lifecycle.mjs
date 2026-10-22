import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { incrementalMvuChecks } from './mvu-incremental.mjs'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

// Real sidebar/controller, with only the installer transport simulated. No E2E
// request is ever allowed to reach the real check/start/cancel updater endpoints.
async function updateChecks({ page, step, report, output }) {
  const pattern = /\/api\/dsh-tavern\/(getUpdateStatus|checkUpdate|startUpdate|cancelUpdate)(?:\?|$)/
  let phase = 'idle', hold, pendingPoll, entered, starts = 0, cancels = 0
  const handler = async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1)
    if (method === 'getUpdateStatus' && hold) {
      const release = pendingPoll = hold; hold = null; entered.resolve()
      await release.promise
      return route.fulfill({ json: { ok: true, status: { phase: 'idle', host: 'desktop' } } }).catch(() => {})
    }
    if (method === 'checkUpdate') phase = 'update-available'
    if (method === 'startUpdate') { starts++; phase = 'running'; return route.abort('failed') }
    if (method === 'cancelUpdate') { cancels++; phase = 'repair-required'; return route.abort('failed') }
    return route.fulfill({ json: { ok: true, status: { phase, host: 'desktop', cancellable: phase === 'running', currentVersion: 'test', latestVersion: 'test-next' } } })
  }
  await page.route(pattern, handler)
  try {
    await step('更新：旧轮询迟到不能覆盖检查结果', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      const check = page.getByRole('button', { name: '检查更新', exact: true })
      await check.waitFor()
      const release = hold = deferred(); entered = deferred()
      await entered.promise
      await check.click()
      await page.getByRole('button', { name: '进行更新', exact: true }).waitFor()
      const response = page.waitForResponse(value => value.url().includes('/getUpdateStatus'))
      release.resolve()
      await response
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.getByRole('button', { name: '进行更新', exact: true }).count(), 1)
    })
    await step('更新：确认期间重复点击只提交一次，响应丢失由轮询恢复', async () => {
      const start = page.getByRole('button', { name: '进行更新', exact: true })
      await start.dispatchEvent('click'); await start.dispatchEvent('click')
      const dialog = page.getByRole('dialog', { name: '确认操作' })
      await dialog.waitFor()
      assert.equal(starts, 0)
      await dialog.getByRole('button', { name: '确认', exact: true }).click()
      const cancel = page.getByRole('button', { name: '取消更新', exact: true })
      await cancel.waitFor()
      assert.equal(starts, 1)
      const cancelButton = await cancel.elementHandle()
      await cancelButton.dispatchEvent('click'); await cancelButton.dispatchEvent('click')
      await page.getByRole('button', { name: '修复安装', exact: true }).waitFor()
      assert.equal(cancels, 1)
      assert.equal(starts, 1)
      await page.screenshot({ path: join(output, 'refactor-update-recovery.png'), fullPage: true })
    })
    await step('更新：刷新重建控制器后保留服务端恢复状态，不重放安装', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '修复安装', exact: true }).waitFor()
      assert.equal(starts, 1); assert.equal(cancels, 1)
    })
    report.updateLifecycle = { stalePollIgnored: true, starts, cancels, lostResponseRecovered: true, reload: true, installer: 'intercepted' }
  } finally {
    hold?.resolve(); pendingPoll?.resolve()
    await page.unroute(pattern, handler)
  }
}

async function bindingChecks({ page, step, data, report, restartServer }) {
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const response = await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })
    return response.json()
  }, [method, args])
  const ok = async (method, args) => {
    const result = await call(method, args)
    assert.equal(result.ok, true, `${method}: ${JSON.stringify(result)}`)
    return result
  }
  const disk = name => readFile(join(data, name), 'utf8').then(JSON.parse)
  let a, b, material, book, renamedBook, renamedCard
  await step('资源绑定：真实 HTTP 并发绑定检查独占，失败后队列仍可使用', async () => {
    const card = name => ok('importCard', { payload: { name: name + '.json', text: JSON.stringify({ name, description: '绑定验收', first_mes: '你好' }) } })
    a = (await card('E2E绑定A')).card.path
    b = (await card('E2E绑定B')).card.path
    material = (await ok('importSource', { payload: { name: 'E2E绑定剧本.txt', text: '第一章\n你走进酒馆。' } })).source.path
    const results = await Promise.all([call('bindScript', { cardPath: a, path: material }), call('bindScript', { cardPath: b, path: material })])
    assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results))
    assert.match(results.find(result => !result.ok).error, /已绑定/)
    const owner = results[0].ok ? a : b
    await ok('deleteScript', { cardPath: owner })
    await ok('bindScript', { cardPath: a, path: material })
    assert.equal((await disk('.material-bindings.json'))[a], material)
  })
  await step('资源绑定：重命名同时更新人物卡引用与全局世界书', async () => {
    book = (await ok('importWorldBook', { payload: { name: 'E2E绑定世界书.json', text: JSON.stringify({ entries: { 0: { uid: 0, key: ['酒馆'], content: 'E2E_BINDING_MARKER', constant: true, disable: false, order: 100 } } }) } })).worldBook.path
    await ok('setWorldBookBindings', { cardPath: a, sources: [{ kind: 'standalone', path: book }] })
    await ok('setGlobalWorldBook', { source: { kind: 'standalone', path: book }, enabled: true })
    renamedBook = (await ok('renameResource', { path: book, name: 'E2E绑定世界书改名.json' })).resource.path
    renamedCard = (await ok('renameResource', { path: a, name: 'E2E绑定A改名.json' })).resource.path
    const bindings = await disk('.worldbook-bindings.json')
    assert.equal(bindings[renamedCard].sources[0].path, renamedBook)
    assert.equal(bindings.$global.sources[0].path, renamedBook)
    assert.equal(bindings[a], undefined)
    assert.equal((await disk('.material-bindings.json'))[renamedCard], material)
    await page.reload({ waitUntil: 'domcontentloaded' })
    assert.equal((await ok('getWorldBookBinding', { cardPath: renamedCard })).binding.source.path, renamedBook)
  })
  await step('资源绑定：重启后关系保持，删除清理引用且失败操作不破坏文件', async () => {
    await restartServer()
    assert.equal((await ok('getWorldBookBinding', { cardPath: renamedCard })).binding.source.path, renamedBook)
    assert.equal((await ok('getWorldBook', { source: { kind: 'standalone', path: renamedBook } })).globalEnabled, true)
    const denied = await call('deleteResource', { path: material })
    assert.equal(denied.ok, false)
    assert.match(denied.error, /仍被人物卡绑定/)
    assert.match(await readFile(join(data, 'resources', material), 'utf8'), /你走进酒馆/)
    await ok('deleteWorldBook', { source: { kind: 'standalone', path: renamedBook } })
    const bindings = await disk('.worldbook-bindings.json')
    assert.deepEqual(bindings[renamedCard].sources, [])
    assert.deepEqual(bindings.$global.sources, [])
    assert.equal((await ok('getWorldBookBinding', { cardPath: renamedCard })).binding.kind, 'none')
    await ok('deleteScript', { cardPath: renamedCard })
    await ok('deleteResource', { path: material })
    await ok('deleteCard', { path: renamedCard })
    await ok('deleteCard', { path: b })
  })
  report.resourceBindings = { exclusive: true, rename: true, globalReferences: true, restart: true, deleteCleanup: true }
}

export async function refactorLifecycleChecks(context) {
  let eventId
  const capture = request => {
    if (!request.url().includes('/updateTavernHelperVariables')) return
    const payload = request.postDataJSON()
    if (payload?.eventId?.startsWith('mvu-work:')) eventId = payload.eventId
  }
  context.page.on('request', capture)
  try { await incrementalMvuChecks(context) }
  finally { context.page.off('request', capture) }
  await context.step('MVU：完成事件的迟到写入被拒绝，已保存变量不变', async () => {
    assert.ok(eventId, 'must capture a real MVU settlement event')
    const before = await context.savedChat()
    const result = await context.page.evaluate(async args => (await fetch('/api/dsh-tavern/updateTavernHelperVariables', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args)
    })).json(), { sessionId: before.sessionId, expectedLifecycleRevision: before.tavernHelperLifecycleRevision || 0,
      eventId, option: { type: 'message', message_id: 0 }, variables: { stat_data: { gold: 999 } } })
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'MVU_SETTLEMENT_EVENT_MISMATCH')
    const after = await context.savedChat()
    assert.deepEqual(after.messages.map(row => row.variables), before.messages.map(row => row.variables))
    context.report.lateMvuWriteRejected = true
  })
  await bindingChecks(context)
  await updateChecks(context)
}
