import test from 'node:test'
import assert from 'node:assert/strict'
import { injectDefinitions } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const yu = { id: 'y', name: '宋玉轩', match: 'Song Yuxuan', enabled: true, traits: { face: 'long black hair, sharp eyes' },
  outfits: [{ id: 'o', name: '常服', upper: 'dark blue jacket', shoes: 'black leather boots', default: true }] }
const defs = { characters: [yu] }

test('按名字注入的外貌紧跟在名字后面，而不是堆到整段末尾', () => {
  const { text } = injectDefinitions('1girl, solo, Song Yuxuan, holding sword, training ground, morning', defs, {}, { raw: '1girl, solo, 宋玉轩, holding sword, training ground, morning' })
  assert.match(text, /^1girl, solo, Song Yuxuan, long black hair, sharp eyes, dark blue jacket, black leather boots, holding sword/)
  assert.match(text, /morning$/)
})

test('规划已经写了她穿什么时，不再补常穿，免得两套衣服打架', () => {
  const raw = '1girl, Song Yuxuan, dark navy training outfit, brown leather boots, standing'
  const { text } = injectDefinitions(raw, defs, {}, { raw })
  assert.match(text, /long black hair/)
  assert.doesNotMatch(text, /black leather boots|dark blue jacket/)
  const wet = injectDefinitions('1girl, Song Yuxuan, wet clothes, standing', defs, {}, { raw: '1girl, Song Yuxuan, wet clothes, standing' }).text
  assert.match(wet, /dark blue jacket/, '只写衣服状态时照常补常穿')
})
