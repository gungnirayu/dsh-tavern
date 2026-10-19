import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import runtime from '../bin/official-desktop-runtime.cjs'

test('Windows 官方 shim 不将中文路径写进批处理，并拒绝未知宿主', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'official-desktop-中文 '))
  t.after(() => rm(root, {recursive: true, force: true}))
  const executable = path.join(root, 'DeepSeek Harness.exe')
  const {app, host, pnpm} = runtime.layout(executable, 'win32')
  // layout initially selects ASAR; use the unpacked build layout for this fixture.
  const unpacked = app.replace(/app\.asar$/, 'app')
  await mkdir(unpacked, {recursive: true})
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify({name: '@deepseek-ai/dsh-desktop'}))
  const paths = runtime.layout(executable, 'win32')
  const cli = path.join(paths.host, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
  await mkdir(path.dirname(cli), {recursive: true}); await writeFile(cli, '')
  await mkdir(path.dirname(pnpm), {recursive: true}); await writeFile(pnpm, '')
  const home = path.join(root, '旧存档')
  const env = runtime.prepare({executable, home, platform: 'win32', env: {Path: 'original'}})
  assert.ok(env.Path.endsWith(';original'))
  assert.equal(env.DSH_HOME, home)
  assert.equal(env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR, path.join(paths.host, 'package.json'))
  for (const name of ['node', 'pnpm', 'dsh']) {
    const shim = await readFile(path.join(home, 'tools/official-desktop/bin', name + '.cmd'), 'utf8')
    assert.match(shim, /^[\x00-\x7f]+$/)
    assert.match(shim, /DisableDelayedExpansion/)
  }
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify({name: 'dsh-desktop'}))
  assert.throws(() => runtime.prepare({executable, home, platform: 'win32'}), /官方 DeepSeek Harness 或社区/)
})

test('社区版 DSH NEXT / DSH Desktop：用自带的 desktop-cli 与按架构的 pnpm，官方优先被发现', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'community-desktop-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const executable = path.join(root, 'DSH NEXT', 'DSH NEXT.exe')
  const app = path.join(root, 'DSH NEXT', 'resources', 'app')
  await mkdir(path.join(app, 'lib'), {recursive: true})
  await writeFile(path.join(app, 'package.json'), JSON.stringify({name: 'dsh-plugin-desktop'}))
  await writeFile(path.join(app, 'lib', 'desktop-cli.js'), '')
  const pnpm = path.join(root, 'DSH NEXT', 'resources', 'runtime', 'x64', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
  await mkdir(path.dirname(pnpm), {recursive: true}); await writeFile(pnpm, '')
  await writeFile(executable, '')
  const paths = runtime.layout(executable, 'win32', 'arm64')
  assert.equal(paths.bootstrap, path.join(app, 'lib', 'desktop-cli.js'))
  assert.equal(paths.pnpm, pnpm, '缺当前架构时回退到已有的运行时')
  const env = runtime.prepare({executable, home: path.join(root, 'home'), platform: 'win32', env: {Path: ''}})
  assert.equal(env.DSH_DESKTOP_DSH_BOOTSTRAP, paths.bootstrap)
  assert.equal(env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR, path.join(app, 'package.json'))
  assert.equal(runtime.discover({DSH_DESKTOP_APP_EXECUTABLE: executable}, 'win32'), executable)
  assert.deepEqual(runtime.APP_NAMES, ['DeepSeek Harness', 'DSH NEXT', 'DSH Desktop'])
})

test('本机官方 Electron 可从中文目录运行 DSH 和 pnpm', async t => {
  let executable
  try { executable = runtime.discover() } catch { t.skip('未安装官方 Desktop'); return }
  const home = await mkdtemp(path.join(tmpdir(), 'official-中文 '))
  t.after(() => rm(home, {recursive: true, force: true}))
  const setup = spawnSync(executable, ['--expose-internals', path.resolve('bin/official-desktop-runtime.cjs'), home],
    {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, encoding: 'utf8'})
  assert.equal(setup.status, 0, setup.stderr)
  const env = {...process.env, ...JSON.parse(setup.stdout), ELECTRON_RUN_AS_NODE: '1'}
  for (const [entry, expected] of [[env.DSH_DESKTOP_DSH_BOOTSTRAP, '0.2.1-rc.2'], [env.DSH_DESKTOP_PNPM_ENTRY, '11.28.5']]) {
    const result = spawnSync(executable, ['--expose-internals', entry, '--version'], {env, encoding: 'utf8'})
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), expected)
  }
})
