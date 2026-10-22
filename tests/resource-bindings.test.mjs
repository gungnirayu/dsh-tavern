import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createResourceBindings } from '../tavern-plugin/lib/domain/resource-bindings.js'
import { normalizeResourcePath } from '../tavern-plugin/lib/domain/file-resources.js'

async function fixture(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'tavern-bindings-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const names = ['cards/a.json', 'cards/b.json', 'materials/story.txt', 'worldbooks/book.json']
  for (const name of names) {
    await mkdir(path.dirname(path.join(dataRoot, name)), { recursive: true })
    await writeFile(path.join(dataRoot, name), '{}')
  }
  const values = new Map()
  const durableFiles = { read: async file => values.get(file), write: async (file, value) => { values.set(file, value) } }
  const bindings = createResourceBindings({ dataRoot, durableFiles, normalizeResourcePath,
    absolute: name => path.join(dataRoot, name), list: async kind => names.filter(name => name.startsWith(kind === 'source' ? 'materials/' : 'scripts/')) })
  return { bindings, dataRoot, values, durableFiles }
}
test('绑定与复合文件操作共享队列，重命名计划持久化后后续绑定才能进入', async t => {
  const { bindings, dataRoot, durableFiles } = await fixture(t)
  await bindings.bindWorldBooks('cards/a.json', [{ kind: 'standalone', path: 'worldbooks/book.json' }])
  await bindings.setGlobalWorldBook('worldbooks/book.json', true)
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), ready = new Promise(resolve => { entered = resolve })
  const moving = bindings.mutate(async edit => {
    const apply = await edit.prepareRename('worldbooks/book.json', 'worldbooks/renamed.json', 'worldbook')
    entered()
    await gate
    await rename(path.join(dataRoot, 'worldbooks/book.json'), path.join(dataRoot, 'worldbooks/renamed.json'))
    await apply({ write: durableFiles.write })
  })
  await ready
  let finished = false
  const binding = bindings.bindWorldBook('cards/b.json', 'worldbooks/renamed.json').then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false)
  release(); await Promise.all([moving, binding])
  assert.equal((await bindings.worldBookBindingForCard('cards/a.json')).sources[0].path, 'worldbooks/renamed.json')
  assert.equal((await bindings.worldBookBindingForCard('cards/b.json')).path, 'worldbooks/renamed.json')
  assert.equal((await bindings.globalWorldBookSources())[0].path, 'worldbooks/renamed.json')
})
test('失败不阻塞队列，绑定独占检查在队列内执行', async t => {
  const { bindings } = await fixture(t)
  await assert.rejects(bindings.mutate(() => { throw new Error('failed mutation') }), /failed mutation/)
  const results = await Promise.allSettled([
    bindings.bindMaterial('cards/a.json', 'materials/story.txt'),
    bindings.bindMaterial('cards/b.json', 'materials/story.txt')
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.deepEqual(await bindings.cardsForMaterial('materials/story.txt'), ['cards/a.json'])
  await bindings.unbindMaterial('cards/a.json')
  await bindings.bindMaterial('cards/b.json', 'materials/story.txt')
  assert.equal(await bindings.scriptForCard('cards/b.json'), 'materials/story.txt')
})
