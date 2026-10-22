import test from 'node:test'
import assert from 'node:assert/strict'
import { createScriptReader } from '../tavern-plugin/lib/domain/script-reader.js'

test('剧本解析按持久版本共享，改绑与文件更新不沿用旧内容', async () => {
  let stamp = 1, source = '第一章。'.repeat(200), reads = 0, binding = 'materials/one.txt'
  const read = createScriptReader({ version: async () => stamp, resources: {
    scriptForCard: async () => binding, readText: async () => { reads++; return source }
  } })
  const [first, concurrent] = await Promise.all([read('cards/a.json'), read('cards/a.json')])
  assert.equal(first, concurrent)
  assert.equal(reads, 1)
  assert.equal(await read('materials/one.txt'), first)
  assert.equal(reads, 1)
  assert.throws(() => { first.chunks[0].text = '污染' }, TypeError)
  source = '第二章。'; stamp++
  assert.equal((await read('cards/a.json')).chunks[0].text, source)
  binding = 'materials/two.txt'
  assert.equal((await read('cards/a.json')).path, binding)
  source = undefined; stamp++
  assert.equal(await read(binding), undefined)
})

test('读取途中版本改变不缓存，读取失败后可重试', async () => {
  let stamp = 1, reads = 0, fail = false
  const read = createScriptReader({ version: async () => stamp, resources: { readText: async () => {
    reads++; if (fail) throw Error('read failed'); if (reads === 1) stamp++; return '正文'
  } } })
  await read('materials/a.txt'); await read('materials/a.txt')
  assert.equal(reads, 2)
  stamp++; fail = true
  await assert.rejects(read('materials/a.txt'), /read failed/)
  fail = false
  assert.equal((await read('materials/a.txt')).chunks[0].text, '正文')
})
