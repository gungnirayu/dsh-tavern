import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeTags } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'
import { expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

test('去重认得权重写法，也去掉被前面更具体的 tag 覆盖的重复衣物', () => {
  const out = dedupeTags('long black hair, ((high ponytail)), dark blue cloth, black leather boots, 1girl, solo, high ponytail, (high ponytail:1.2), dark blue clothes, leather boots, wet clothes')
  assert.equal(out, 'long black hair, ((high ponytail)), dark blue cloth, black leather boots, 1girl, solo, wet clothes')
})

test('人数、视角这类独立 tag 不会被更长的 tag 吞掉', () => {
  assert.equal(dedupeTags('pov hands, pov, solo, solo focus, nude, partially nude'), 'pov hands, pov, solo, solo focus, nude, partially nude')
})

test('tag 写法里服装的「整体印象」不再写进提示词，自然语言写法照旧', () => {
  const yu = { id: 'y', name: '宋玉轩', match: 'Song Yuxuan', enabled: true, traits: { face: 'long black hair' },
    outfits: [{ id: 'o', name: '常服', upper: 'dark blue jacket', lower: 'dark trousers', full: 'martial attire, practical', default: true }] }
  const tags = expandRosterCalls('${"name":"Song Yuxuan", "outfit":"常服"}$, 1girl', { characters: [yu] }, 'auto')
  assert.match(tags, /dark blue jacket/)
  assert.doesNotMatch(tags, /martial attire/)
  const natural = expandRosterCalls('${"name":"Song Yuxuan", "outfit":"常服"}$', { characters: [yu] }, 'auto', { style: 'natural' })
  assert.match(natural, /martial attire/)
})
