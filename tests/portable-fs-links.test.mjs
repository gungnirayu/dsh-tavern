import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { copyTreeSync, repairDirectoryLinksSync } from '../bin/portable-fs.mjs'

const windows = process.platform === 'win32'
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'portable-fs-links-'))
// File symlinks need admin or Developer Mode on Windows; GitHub's Windows runners have both.
const canSymlink = root => { try { symlinkSync('x', path.join(root, 'probe'), 'file'); return true } catch { return false } }

test('a relative directory link copied out of a moved profile still opens once moved back', t => {
  const root = temp()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  if (windows && !canSymlink(root)) return t.skip('symlinks are not allowed for this account')
  mkdirSync(path.join(root, 'apps', 'plugin'), { recursive: true })
  writeFileSync(path.join(root, 'apps', 'plugin', 'package.json'), '{}')
  const profile = path.join(root, 'profiles', 'tavern')
  mkdirSync(path.join(profile, 'node_modules'), { recursive: true })
  symlinkSync(path.join('..', '..', '..', 'apps', 'plugin'), path.join(profile, 'node_modules', 'plugin'), windows ? 'dir' : undefined)
  // The installer moves the profile into a backup at another depth, copies it, then moves the copy back.
  const moved = path.join(root, 'backups', 'install', 'deeper', 'previous-tavern')
  mkdirSync(path.dirname(moved), { recursive: true })
  renameSync(profile, moved)
  const staged = path.join(root, 'backups', 'install', 'deeper', 'prepared-tavern')
  copyTreeSync(moved, staged)
  renameSync(staged, profile)
  const link = path.join(profile, 'node_modules', 'plugin')
  assert.equal(realpathSync(link), realpathSync(path.join(root, 'apps', 'plugin')))
  assert.deepEqual(readdirSync(link), ['package.json'])
})

test('untraversable Windows file links to a directory are replaced by junctions', t => {
  const root = temp()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const nodeModules = path.join(root, 'node_modules')
  mkdirSync(path.join(nodeModules, '@scope'), { recursive: true })
  mkdirSync(path.join(root, 'plugin'))
  writeFileSync(path.join(root, 'plugin', 'package.json'), '{}')
  if (!windows) {
    symlinkSync(path.join(root, 'plugin'), path.join(nodeModules, 'plugin'))
    assert.deepEqual(repairDirectoryLinksSync(nodeModules), [])
    return
  }
  if (!canSymlink(root)) return t.skip('symlinks are not allowed for this account')
  const broken = [path.join(nodeModules, 'plugin'), path.join(nodeModules, '@scope', 'plugin')]
  for (const link of broken) symlinkSync(path.join(root, 'plugin'), link, 'file')
  symlinkSync(path.join(root, 'plugin'), path.join(nodeModules, 'healthy'), 'junction')
  assert.throws(() => realpathSync(broken[0]))
  assert.deepEqual(repairDirectoryLinksSync(nodeModules).sort(), [...broken].sort())
  for (const link of broken) assert.deepEqual(readdirSync(link), ['package.json'])
  assert.deepEqual(repairDirectoryLinksSync(nodeModules), [])
})
