import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneReferences } from '../tavern-plugin/lib/domain/scene-references.js'

const snapshot = text => ({ cardContextSnapshotVersion: 5, cardContextSnapshot: '【故事设定 · 人物卡】\n名字: 林岚\n\n' + text })
const context = { target: { turn: 2 }, sources: [{ id: 'target', turn: 2, text: '林岚走进青石车站。' }] }

test('many tiny matching paragraphs cannot inflate reply metadata beyond three fragments', () => {
  const refs = createSceneReferences({ ...context, snapshot: snapshot('设定: ' + Array.from({ length: 800 }, (_, index) => '林岚' + index).join('\n\n')) })
  for (let index = 0; index < 3; index++) assert.equal(refs.read({ query: '林岚' }).sources.length, 3)
})
