import assert from 'node:assert/strict'
import test from 'node:test'

import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

// 设置 → 插件：已是最新时不显示更新按钮，有新版时按钮写明版本，停用/启用原地切换。
test('插件列表按 Release 显示更新、停用与启用', async t => {
  let plugins = [
    { folder: 'pet', name: 'dsh-tavern-desktop-pet', version: '0.2.2', description: '桌宠', source: { kind: 'github', repo: 'bigmalove/dsh-tavern-desktop-pet', resolved: 'Release v0.2.2' }, enabled: true, state: 'loaded', reason: '' },
    { folder: 'hub', name: 'dsh-runninghub', version: '1.1.4', description: 'RunningHub', source: { kind: 'github', repo: 'author/runninghub', resolved: 'Release v1.1.4' }, enabled: true, state: 'loaded', reason: '' },
    { folder: 'panel', name: 'dsh-tavern-worldbook-panel', version: '0.1.0', description: '世界书', source: { kind: 'folder' }, enabled: true, state: 'loaded', reason: '' },
  ]
  let updates = [
    { folder: 'pet', current: '0.2.2', latest: 'v0.2.2', status: 'latest' },
    { folder: 'hub', current: '1.1.4', latest: 'v1.1.5', status: 'available' },
  ]
  function respond(method, args) {
    if (method === 'listUserPlugins') return { plugins, dir: '/tmp/tavern/plugins' }
    if (method === 'checkUserPluginUpdates') return { plugins: updates }
    if (method === 'disableUserPlugin' || method === 'enableUserPlugin') {
      const enabled = method === 'enableUserPlugin'
      plugins = plugins.map(plugin => plugin.folder === args.folder ? { ...plugin, enabled, state: enabled ? 'pending' : 'disabled', reason: '' } : plugin)
      return { plugin: { folder: args.folder, enabled } }
    }
    if (method === 'updateUserPlugin') {
      plugins = plugins.map(plugin => plugin.folder === args.folder ? { ...plugin, version: '1.1.5', state: 'restart' } : plugin)
      updates = updates.map(update => update.folder === args.folder ? { ...update, current: '1.1.5', status: 'latest' } : update)
      return { plugin: { folder: args.folder, name: 'dsh-runninghub', version: '1.1.5', replaced: true } }
    }
  }
  const { page } = await openTavernSettings(t, { respond, section: 'dsh-tavern: plugins settings section' })
  const pet = page.locator('.dsh-tavern-user-plugin').filter({ hasText: 'dsh-tavern-desktop-pet' })
  const hub = page.locator('.dsh-tavern-user-plugin').filter({ hasText: 'dsh-runninghub' })
  const panel = page.locator('.dsh-tavern-user-plugin').filter({ hasText: 'dsh-tavern-worldbook-panel' })
  await pet.waitFor()

  await pet.locator('.dsh-tavern-user-plugin-copy .dsh-tavern-user-plugin-update.is-latest').waitFor()
  assert.equal(await pet.locator('.dsh-tavern-user-plugin-actions .dsh-tavern-user-plugin-update').count(), 0, '更新状态不放进按钮区')
  assert.equal(await pet.getByRole('button', { name: /更新/ }).count(), 0, '已是最新时不出现更新按钮')
  assert.equal(await panel.getByRole('button', { name: /更新/ }).count(), 0, '手动放入的插件没有更新按钮')

  await hub.getByRole('button', { name: '更新到 1.1.5', exact: true }).waitFor()
  await hub.getByRole('button', { name: '更新到 1.1.5', exact: true }).click()
  await page.getByText('已更新 dsh-runninghub 1.1.5，重启 DSH 后生效。', { exact: true }).waitFor()
  await hub.getByText('重启 DSH 后生效', { exact: true }).waitFor()
  await hub.getByText('已是最新', { exact: true }).waitFor()

  await pet.getByRole('button', { name: '停用', exact: true }).click()
  await pet.getByText('已停用', { exact: true }).waitFor()
  await pet.getByRole('button', { name: '启用', exact: true }).waitFor()
  await page.getByText('已停用 dsh-tavern-desktop-pet，刷新页面后生效。', { exact: true }).waitFor()

  await pet.getByRole('button', { name: '启用', exact: true }).click()
  await pet.getByRole('button', { name: '停用', exact: true }).waitFor()
  await pet.getByText('已停用', { exact: true }).waitFor({ state: 'detached' })
  await page.getByText('已启用 dsh-tavern-desktop-pet，刷新页面后生效。', { exact: true }).waitFor()
})
