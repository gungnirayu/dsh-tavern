import assert from 'node:assert/strict'
import test from 'node:test'
import childProcess from 'node:child_process'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { installHostSubprocessPatch } from '../tavern-plugin/lib/domain/host-subprocess-patch.js'
import { setTimeout as delay } from 'node:timers/promises'

const runtime = process.env.TAVERN_DSH_015_RUNTIME
const anchor = runtime ? join(runtime, 'package.json') : process.env.DSH_BOOT_MODULE

test('Windows Job runner stays hidden while preserving output and exit status', {
  skip: process.platform !== 'win32' || !anchor,
  timeout: 15000,
}, async t => {
  const require = createRequire(anchor)
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: Local } = await load('@deepseek-ai/dsh-subprocess-local')
  const original = Local.prototype.spawn
  const terminal = Local.prototype.spawnTerminal
  const entry = require.resolve('@deepseek-ai/dsh-subprocess-local')
  const source = readFileSync(entry, 'utf8')
  const restore = await installHostSubprocessPatch({ hostRequire: require })
  t.after(restore)
  const secondRestore = await installHostSubprocessPatch({ hostRequire: require })
  secondRestore()
  secondRestore()
  assert.notEqual(Local.prototype.spawn, original)
  assert.equal(Local.prototype.spawnTerminal, terminal)
  const calls = []
  const nativeSpawn = childProcess.spawn
  t.mock.method(childProcess, 'spawn', (command, args, options) => {
    if (args.some(arg => String(arg).endsWith('runner.js'))) calls.push(options)
    return nativeSpawn(command, args, options)
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const ctx = new Context()
  const plugin = ctx.plugin(Local)
  await plugin.await()
  t.after(() => plugin.dispose())
  assert.equal(ctx.subprocess.selectContainmentMode('ordinary'), 'windows-job')
  const collect = { maxBytes: 4096, spill: { maxBytes: 4096 } }
  const handle = ctx.subprocess.spawn({
    argv: [process.execPath, '-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exitCode=7'],
    cwd: process.cwd(), env: {}, graceMs: 100,
    stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
  })
  assert.equal((await handle.done).exitCode, 7)
  await handle.waitForExit()
  assert.equal(handle.collected.stdout.readFrom(0).text, 'out')
  assert.equal(handle.collected.stderr.readFrom(0).text, 'err')
  assert.equal(calls.length, 1, 'must exercise the real Windows Job launcher')
  assert.equal(calls[0].windowsHide, true)
  const echo = ctx.subprocess.spawn({
    argv: [process.execPath, '-e', 'process.stdin.pipe(process.stdout)'],
    cwd: process.cwd(), env: {}, graceMs: 100,
    stdio: { stdin: { data: 'input preserved' }, stdout: collect, stderr: collect },
  })
  assert.equal((await echo.done).exitCode, 0)
  await echo.waitForExit()
  assert.equal(echo.collected.stdout.readFrom(0).text, 'input preserved')
  const running = ctx.subprocess.spawn({
    argv: [process.execPath, '-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'],
    cwd: process.cwd(), env: {}, graceMs: 100,
    stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
  })
  const deadline = Date.now() + 5000
  while (!running.collected.stdout.readFrom(0).text && Date.now() < deadline) await delay(10)
  assert.equal(running.collected.stdout.readFrom(0).text, 'ready')
  running.terminate()
  await running.done
  await running.waitForExit()
  assert.equal(calls.length, 3)
  assert.ok(calls.every(options => options.windowsHide === true))
  assert.equal(readFileSync(entry, 'utf8'), source)
  restore()
  assert.equal(Local.prototype.spawn, original)
})

test('other platforms do not resolve or change host packages', async () => {
  const restore = await installHostSubprocessPatch({ platform: 'linux', hostRequire: { resolve() { throw new Error('must not resolve') } } })
  restore()
})

// 0.2.0-rc.2 适配：宿主入口顶层就 `createLazyRequire("node-pty", import.meta.url)`。补丁把改写后的
// 源码当 data: 模块加载，data: 里的 import.meta.url 是 data URL，createRequire 直接抛
// ERR_INVALID_ARG_VALUE（真机取证 ERR_INVALID_ARG_VALUE @ data:…:1262:24）。这里镜像那段改写，
// 不启真实宿主即可验证 import.meta.url 被换成入口文件 URL。
test('补丁镜像改写：data: 模块前把 import.meta.url 换成入口文件 URL', () => {
  const sample = [
    'import { createLazyRequire } from "@deepseek-ai/dsh-lazy-require";',
    'import { spawn } from "node:child_process";',
    'import { logSpillFailure } from "./output.js";',
    'const requireNodePty = createLazyRequire("node-pty", import.meta.url);',
    'export { createLazyRequire, requireNodePty };',
    '',
  ].join('\n')
  const resolve = specifier => specifier.startsWith('./')
    ? 'file:///host/pkg/lib/' + specifier.slice(2)
    : 'file:///host/node_modules/' + specifier + '/index.js'
  const modified = sample
    .replace(/\bfrom "([^"]+)"/g, (_, specifier) => 'from ' + JSON.stringify(
      specifier.startsWith('node:') ? specifier : resolve(specifier)))
    .replaceAll('import.meta.url', JSON.stringify('file:///host/pkg/lib/index.js'))
  assert.doesNotMatch(modified, /import\.meta\.url/)
  assert.match(modified, /createLazyRequire\("node-pty", "file:\/\/\/host\/pkg\/lib\/index\.js"\)/)
  assert.match(modified, /from "file:\/\/\/host\/node_modules\/@deepseek-ai\/dsh-lazy-require\/index\.js"/)
  assert.match(modified, /from "node:child_process"/)
  assert.match(modified, /from "file:\/\/\/host\/pkg\/lib\/output\.js"/)
})
