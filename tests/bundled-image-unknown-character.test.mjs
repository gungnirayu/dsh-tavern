import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const mei = { id: 'm', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'MEI FACE' }, outfits: [] }
const run = (text, characters = [mei]) => expandRosterCalls(text, { characters }, 'auto')

test('人物库外的角色：保留规划写在宏里的英文服装和角度，不只剩名字', () => {
  const out = run('${"name":"Lu Qi", "angle":"from front", "upperBody":"sfw", "lowerBody":"hidden", "outfit":"light green ruqun, white socks, cloth shoes"}$, 1girl, smile')
  assert.equal(out, 'Lu Qi, light green ruqun, white socks, cloth shoes, from front, 1girl, smile')
})

test('人物库外的角色：赤脚画面去掉鞋，中文服装名与占位值不进提示词', () => {
  assert.doesNotMatch(run('${"name":"Lu Qi", "outfit":"green dress, cloth shoes"}$, barefoot, garden'), /shoes/)
  assert.equal(run('${"name":"Lu Qi", "outfit":"绿色襦裙"}$'), 'Lu Qi')
  assert.equal(run('${"name":"Lu Qi", "outfit":"none"}$'), 'Lu Qi')
  assert.equal(run('${"name":"xiao yu"}$'), 'xiao yu', '只有名字时保持原样')
})

test('人物库里的角色不受影响', () => {
  assert.match(run('${"name":"A Mei", "outfit":"red dress"}$'), /MEI FACE.*red dress|red dress.*MEI FACE/)
})
