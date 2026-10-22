import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'
import { characterRoster } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'

const yu = { id: 'y', name: '宋玉轩', match: 'Song Yuxuan', enabled: true, traits: { feature: 'proud, fierce', face: 'long black hair, sharp eyes' }, outfits: [] }

test('性格气质不写进画图提示词，只给规划参考', () => {
  const out = expandRosterCalls('${"name":"Song Yuxuan", "angle":"from front"}$, 1girl, closed eyes, relaxed', { characters: [yu] }, 'auto')
  assert.match(out, /long black hair, sharp eyes/)
  assert.doesNotMatch(out, /proud|fierce/)
  const roster = characterRoster({ characters: [yu] })
  assert.match(roster, /性格气质（据此挑这一刻的表情[^）]*）：proud, fierce/)
})
