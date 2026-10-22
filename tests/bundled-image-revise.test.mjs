import test from 'node:test'
import assert from 'node:assert/strict'
import { createMediaActions, withTaskFields } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/media-actions.js'

function fixture({ job = { id: 'j1', state: 'done', params: { rawTag: 'old prompt' } } } = {}) {
  const item = { id: 'm1', kind: 'dsh-tavern-image/image', turn: 3, textVersion: 'v', status: 'ready', attachment: { attachmentId: 'a' }, prompt: '', data: { jobId: 'j1' } }
  const updates = [], started = [], revised = []
  const tavern = {
    getTurn: async () => ({ textVersion: 'v' }),
    list: async () => [item],
    update: async (id, changes) => { updates.push(changes); Object.assign(item, changes); return item },
  }
  const actions = createMediaActions({
    tavern, attachments: { saveImage: async () => ({}) }, readFileAsBytes: async () => new Uint8Array(),
    getJob: async id => (id === 'j1' ? job : { id, state: 'running' }),
    startReplacement: async input => { started.push(input); return { jobId: 'j2' } },
    revisePrompt: async input => { revised.push(input); return 'new prompt' },
    cancelJob: async () => {}, pollMs: 5,
  })
  return { actions, updates, started, revised, item }
}
const ctx = { gameId: 'g', turn: 3, textVersion: 'v', mediaId: 'm1' }

test('重新整理提示词：按意见改写原提示词，再用新提示词重画；整理期间卡片显示「整理提示词」', async () => {
  const f = fixture()
  const result = await f.actions.handle({ ...ctx, operation: 'revise', instruction: '改成雨夜' })
  assert.equal(result.ok, true)
  assert.deepEqual(f.revised.map(input => [input.prompt, input.instruction]), [['old prompt', '改成雨夜']])
  assert.equal(f.started[0].prompt, 'new prompt')
  assert.equal(f.updates[0].activity.label, '整理提示词')
  f.actions.dispose()
})

test('取消后结果未定：卡片给「查询结果」「仍然重画」；有图时失败不另给「重试」', () => {
  const unsettled = withTaskFields({ data: { replacement: { state: 'cancelled', cancelMayHaveContinued: true } } })
  assert.deepEqual(unsettled.actions.map(action => action.id), ['recover', 'force-redraw'])
  assert.ok(unsettled.actions[1].confirm)
  assert.deepEqual(withTaskFields({ status: 'ready', data: { replacement: { state: 'failed' } } }).actions, [])
  assert.deepEqual(withTaskFields({ status: 'failed', data: { replacement: { state: 'failed' } } }).actions.map(action => action.id), ['retry'])
})
