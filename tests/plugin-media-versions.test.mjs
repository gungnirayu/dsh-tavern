import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginMedia, publicPluginMedia } from '../tavern-plugin/lib/domain/plugin-media.js'

function memoryStore() {
  const files = new Map()
  return {
    readJson: async path => structuredClone(files.get(path)),
    updateJson: async (path, change) => { files.set(path, change(structuredClone(files.get(path)))) },
    remove: async path => files.delete(path)
  }
}
const image = id => ({ attachmentId: id, mediaType: 'image/png', bytes: 1, width: 1, height: 1 })

test('插图换新图时旧图留作早期版本；插图卡的标准字段可写', async () => {
  let clock = 0
  const media = createPluginMedia({ store: memoryStore(), now: () => ++clock })
  const item = await media.attach({ chatId: 'c', sessionId: 's', owner: 'p', turn: 1, key: 'k', currentKey: 'k', item: { kind: 'p/image', status: 'ready', attachment: image('a1'), caption: '一', prompt: 'first' } })
  await media.patch({ chatId: 'c', owner: 'p', itemId: item.id, changes: { activity: { label: '重画中', cancellable: true }, actions: [{ id: 'retry', label: '重试' }] } })
  let next = await media.patch({ chatId: 'c', owner: 'p', itemId: item.id, changes: { attachment: image('a2'), prompt: 'second', activity: null, actions: [] } })
  assert.deepEqual(next.history.map(entry => [entry.attachment.attachmentId, entry.prompt]), [['a1', 'first']])
  assert.equal(next.activity, null)
  const shown = publicPluginMedia(next)
  assert.deepEqual(shown.history, [{ caption: '一', prompt: 'first', createdAt: 2 }])
  assert.equal(shown.prompt, 'second')
  await assert.rejects(media.patch({ chatId: 'c', owner: 'p', itemId: item.id, changes: { actions: [{ id: 'Bad Id', label: 'x' }] } }), /actions/)
  next = await media.patch({ chatId: 'c', owner: 'p', itemId: item.id, changes: { attachment: image('a3') } })
  assert.equal(next.history.length, 2)
})

test('玩家删版本：删早期版本只去掉它；删当前图由上一版顶上；最后一张删掉整项', async () => {
  const media = createPluginMedia({ store: memoryStore() })
  const item = await media.attach({ chatId: 'c', sessionId: 's', owner: 'p', turn: 1, key: 'k', currentKey: 'k', item: { kind: 'p/image', attachment: image('a1') } })
  for (const id of ['a2', 'a3']) await media.patch({ chatId: 'c', owner: 'p', itemId: item.id, changes: { attachment: image(id) } })
  let left = await media.removeVersion({ chatId: 'c', itemId: item.id, version: 0 })
  assert.deepEqual([...left.history.map(entry => entry.attachment.attachmentId), left.attachment.attachmentId], ['a2', 'a3'])
  left = await media.removeVersion({ chatId: 'c', itemId: item.id, version: null })
  assert.equal(left.attachment.attachmentId, 'a2')
  assert.deepEqual(left.history, [])
  assert.equal(await media.removeVersion({ chatId: 'c', itemId: item.id }), null)
  assert.deepEqual(await media.list({ chatId: 'c' }), [])
})
