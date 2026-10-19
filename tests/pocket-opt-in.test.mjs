import test from 'node:test'
import assert from 'node:assert/strict'

test('each host drops the patch of the mobile layout it does not install', async () => {
  const { prepareProfileWorkspace, mergeProfileManifest } = await import('../bin/profile-configuration.mjs')
  const { parse } = await import('yaml')
  const { readFile } = await import('node:fs/promises')
  const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
  const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const host of ['desktop', 'cli', 'android']) {
    const manifest = mergeProfileManifest({ source, pluginPath: '/x/tavern-plugin', dataRoot: '/x/data', host, dshVersion: '0.1.5-rc.2' })
    const patched = Object.keys(parse(prepareProfileWorkspace(workspace, manifest)).patchedDependencies || {})
    for (const key of patched) {
      const name = key.slice(0, key.lastIndexOf('@'))
      assert.ok(manifest.dependencies[name], `${host} 声明了未安装包的补丁：${key}`)
    }
    assert.equal(patched.some(key => key.startsWith('dsh-web-mobile@')), host === 'android')
  }
})

test('better-sidebar follows the host line: DSHA 0.2.0 gets 0.26 and its patch, 0.2.1 and unlisted lines keep 0.28', async () => {
  const { prepareProfileWorkspace, mergeProfileManifest } = await import('../bin/profile-configuration.mjs')
  const { parse } = await import('yaml')
  const { existsSync } = await import('node:fs')
  const { readFile } = await import('node:fs/promises')
  const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
  const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const [dshVersion, expected] of [['0.2.0-rc.2', '0.26.0'], ['0.2.1-rc.2', '0.28.0'], ['0.2.9', '0.28.0']]) {
    const manifest = mergeProfileManifest({ source, pluginPath: '/x/tavern-plugin', dataRoot: '/x/data', host: 'android', dshVersion })
    assert.equal(manifest.dependencies['dsh-better-sidebar'], expected, dshVersion)
    const patched = parse(prepareProfileWorkspace(workspace, manifest)).patchedDependencies || {}
    const sidebarPatches = Object.keys(patched).filter(key => key.startsWith('dsh-better-sidebar@'))
    assert.deepEqual(sidebarPatches, [`dsh-better-sidebar@${expected}`], dshVersion)
    assert.ok(existsSync(new URL(`../${patched[sidebarPatches[0]]}`, import.meta.url)), patched[sidebarPatches[0]])
  }
})
