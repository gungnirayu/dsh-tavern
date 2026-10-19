import test from 'node:test'
import assert from 'node:assert/strict'
import { STORY_SUMMARY_NOTE, storySummaryVolumes, storyVolumeMerge, storyVolumePlan } from '../tavern-plugin/lib/domain/story-compaction.js'

const preamble = 'This is an automatically generated checkpoint ...\n\n<compacted-summary>'
const checkpoint = texts => ({ id: 'cp', role: 'user', source: { kind: 'plugin:compact', compactionId: 'c1' }, content: [preamble, ...texts, '</compacted-summary>'].map(text => ({ type: 'text', text })) })
const request = history => ({ purpose: 'compaction', messages: [...history, { role: 'user', content: [{ type: 'text', text: '总结指令' }] }] })
const player = text => ({ role: 'user', source: { kind: 'human' }, content: [{ type: 'text', text }] })

test('第一次压缩：从第 1 轮写起第一卷，摘要前带回查说明', () => {
  const plan = storyVolumePlan(request([player('行动')]), { through: 12 })
  assert.deepEqual(plan.prefix, [STORY_SUMMARY_NOTE])
  assert.match(plan.instruction, /「【第 1–12 轮剧情摘要】」/)
  assert.match(STORY_SUMMARY_NOTE, /tavern_recall_history/)
})

test('之后的压缩：旧卷原样带上，只写接下来的新一卷', () => {
  const old = checkpoint([STORY_SUMMARY_NOTE, '【第 1–12 轮剧情摘要】\n甲在第三轮许下约定。', '【最近 2 轮原文（未压缩，按时间顺序）】\n\n[玩家]\n行动'])
  const plan = storyVolumePlan(request([old, player('行动')]), { through: 30 })
  assert.deepEqual(plan.prefix, [STORY_SUMMARY_NOTE, '【第 1–12 轮剧情摘要】\n甲在第三轮许下约定。'])
  assert.match(plan.instruction, /旧卷会原样保留/)
  assert.match(plan.instruction, /「【第 13–30 轮剧情摘要】」/)
})

test('一段输出里的多卷、以及分卷前的旧式摘要都能拆出来', () => {
  const volumes = storySummaryVolumes([checkpoint(['旧式整段摘要', '【前情总览（截至第 20 轮）】\n总览\n\n【第 21–40 轮剧情摘要】\n新卷'])])
  assert.deepEqual(volumes.map(volume => [volume.text.split('\n')[0], volume.through]), [['【前情总览】', null], ['【前情总览（截至第 20 轮）】', 20], ['【第 21–40 轮剧情摘要】', 40]])
})

test('旧卷超出预算时只合并最老的几卷，较新的卷原样保留，新一卷照常写', () => {
  const volume = (from, to, size) => `【第 ${from}–${to} 轮剧情摘要】\n` + '事'.repeat(size)
  const old = checkpoint([volume(1, 50, 300), volume(51, 110, 300), volume(111, 170, 300)])
  const plan = storyVolumePlan(request([old]), { through: 230, budget: 700, estimate: text => text.length })
  assert.deepEqual(plan.merge.volumes.map(item => item.through), [50, 110])
  assert.equal(plan.merge.through, 110)
  assert.deepEqual(plan.prefix, [STORY_SUMMARY_NOTE, volume(111, 170, 300)])
  assert.match(plan.instruction, /「【第 171–230 轮剧情摘要】」/)
  const merge = storyVolumeMerge(plan.merge)
  assert.equal(merge.header, '【前情总览（截至第 110 轮）】')
  assert.match(merge.prompt, /约为原文的一半/)
  assert.ok(merge.prompt.includes(volume(1, 50, 300)) && merge.prompt.includes(volume(51, 110, 300)) && !merge.prompt.includes(volume(111, 170, 300)))
})

test('未超预算时不合并', () => {
  const old = checkpoint(['【第 1–12 轮剧情摘要】\n' + '事'.repeat(40)])
  assert.equal(storyVolumePlan(request([old]), { through: 30, budget: 1000, estimate: text => text.length }).merge, undefined)
})
