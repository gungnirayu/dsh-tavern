import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createSceneIllustrations, sceneTarget } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { sceneSlotKey } from '../tavern-plugin/lib/domain/scene-slots.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

// Tavern no longer draws: these are pictures old versions saved, read, exported and deleted.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const folder = 'scene-images/' + createHash('sha256').update('test-chat').digest('hex') + '/'
const chat = () => ({ id: 'test-chat', mode: 'story', sessionId: 'parent', messages: [{ role: 'user', text: '走到窗边' }, { role: 'assistant', turn: 2, sourceText: '她站在窗边。' }] })
const version = (id, extra = {}) => ({ id, createdAt: Number(id.slice(1)), attachment: { attachmentId: 'a-' + id, mediaType: 'image/png' }, plan: { description: '窗边一景', anchor: '窗边', scene: { composition: { text: '单人半身' } }, style: { tags: 'watercolor' } }, ...extra })
const record = (key, versions) => ({ key, turn: 2, status: 'succeeded', diagnosticContext: { chatId: 'test-chat', sessionId: 'parent' }, versions })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tavern-scene-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  const deps = {
    store, chatForSession: async () => chat(), chatSummaries: async () => [],
    attachments: () => ({ readImage: async ref => ({ ref, data: png }) })
  }
  const key = sceneTarget(chat(), 2).key
  await store.writeJson(folder + key + '.json', record(key, [version('v1'), version('v2')]))
  return { store, deps, key, service: createSceneIllustrations(deps) }
}

test('a turn shows its saved versions and added pictures, read-only', async t => {
  const fx = await fixture(t)
  const extraKey = sceneSlotKey(fx.key, 1)
  await fx.store.writeJson(folder + extraKey + '.json', record(extraKey, [version('v3')]))
  const state = await fx.service.status('parent', 2)
  assert.equal(state.key, fx.key)
  assert.deepEqual(state.versions.map(item => [item.id, item.description, item.anchor, item.composition, item.style]),
    [['v1', '窗边一景', '窗边', '单人半身', 'watercolor'], ['v2', '窗边一景', '窗边', '单人半身', 'watercolor']])
  assert.ok(state.versions.every(item => !('attachment' in item) && !('plan' in item)), 'storage details stay on the server')
  assert.deepEqual(state.extras.map(item => [item.slot, item.versions.map(v => v.id)]), [[1, ['v3']]])
  assert.deepEqual((await fx.service.readImage('parent', 2, fx.key, 'v1')).data, png)
  await assert.rejects(fx.service.readImage('parent', 2, 'other', 'v1'), /当前正文版本/)
  assert.equal((await fx.service.status('parent', 9)).reason, 'target-unavailable')
})

test('export takes each slot latest picture with its anchor', async t => {
  const fx = await fixture(t)
  await fx.store.writeJson(folder + fx.key + '.json', record(fx.key, [version('v1', { anchor: '窗边' }), version('v2')]))
  const images = await fx.service.exportImages('parent', [2, 5])
  assert.deepEqual(images.map(image => [image.turn, image.slot, image.anchor, image.mediaType]), [[2, 0, '窗边', 'image/png']])
})

test('history lists pictures across games by chat id, reads and removes them without resolving a session', async t => {
  const fx = await fixture(t)
  let items = await fx.service.history()
  assert.deepEqual(items.map(item => [item.chatId, item.key, item.turn, item.deleted, item.versions.length]), [['test-chat', fx.key, 2, true, 2]])
  fx.deps.chatSummaries = async () => [{ id: 'test-chat', cardName: '段莹莹', title: '晨起' }]
  items = await fx.service.history('test-chat')
  assert.deepEqual([items[0].cardName, items[0].title, items[0].deleted], ['段莹莹', '晨起', false])
  fx.deps.chatForSession = async () => { throw new Error('session closed') }
  assert.deepEqual((await fx.service.readStoredImage('test-chat', fx.key, 'v1')).data, png)
  await assert.rejects(fx.service.readStoredImage('test-chat', '../plans', 'v1'), /图片地址不合法/)
  const results = await fx.service.removeStoredImages([{ chatId: 'test-chat', key: fx.key, versionId: 'v1' }, { chatId: 'test-chat', key: fx.key, versionId: 'missing' }])
  assert.deepEqual(results.map(row => row.ok), [true, false])
  const saved = await fx.store.readJson(folder + fx.key + '.json')
  assert.deepEqual(saved.versions.map(item => item.id), ['v2'])
  assert.equal(saved.deletedVersions.length, 1)
  assert.equal((await fx.service.history())[0].versions.length, 1)
})
