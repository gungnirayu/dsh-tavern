import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCardImportIdentity } from '../tavern-plugin/lib/domain/card-import-identity.js'

test('同一个卡文件再导入：卡库里还没改过的那张直接复用；改过、删了或文件不同都照常新增', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'card-identity-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const fileA = join(dir, 'a.dshcard'), fileB = join(dir, 'b.dshcard')
  await writeFile(fileA, 'card-a')
  await writeFile(fileB, 'card-b')
  const texts = new Map(), manifests = new Map()
  const castAssets = {
    read: async cardPath => manifests.get(cardPath) || { version: 1, characters: [] },
    setSource: async (cardPath, source) => { manifests.set(cardPath, { ...(manifests.get(cardPath) || {}), source }) }
  }
  const identity = createCardImportIdentity({ cardPaths: async () => [...texts.keys()], castAssets, readCardText: async cardPath => texts.get(cardPath) })

  const shaA = await identity.fileSha256(fileA)
  assert.match(shaA, /^[0-9a-f]{64}$/)
  assert.notEqual(shaA, await identity.fileSha256(fileB))
  assert.equal(await identity.find(shaA), null, '卡库里没有')

  texts.set('cards/鱼.json', '{"name":"鱼"}')
  await identity.remember('cards/鱼.json', shaA)
  assert.equal(await identity.find(shaA), 'cards/鱼.json', '同一个文件：认出原来那张')
  assert.equal(await identity.find(await identity.fileSha256(fileB)), null, '不同文件不算')

  texts.set('cards/鱼.json', '{"name":"鱼","edited":true}')
  assert.equal(await identity.find(shaA), null, '玩家改过这张卡，再导入就是要一份原版')

  texts.delete('cards/鱼.json')
  assert.equal(await identity.find(shaA), null, '卡删了，旧记录不算')
})
