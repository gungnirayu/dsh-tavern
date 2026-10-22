import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

test('注册的本局设置保存玩家称呼、预设与后台模型，失败时保留已保存模型', async t => {
  let playerName = '你', preset = null, model = null, fail = false
  const { page, calls } = await openTavernSettings(t, { sessionId: 'game', respond(method, args) {
    if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
    if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story', playerName, runtimePreset: preset, statusBarPlacement: 'sidebar' } }
    if (method === 'listPresets') return { presets: [{ path: 'presets/one.json', title: '测试预设', valid: true, recognized: true }] }
    if (method === 'getUserPreferenceProfile') return { userProfile: { profiles: [] }, currentConversation: { enabled: false } }
    if (method === 'listGamePlugins') return { plugins: { plugins: [], errors: [], settings: [], tasks: { settlement: [], manual: [] } } }
    if (method === 'getConversationWritingSkills') return { skills: [] }
    if (method === 'setPlayerName') { playerName = args.userName; return { playerName } }
    if (method === 'applyConversationPreset') { preset = { id: args.path, name: '测试预设' }; return {} }
    if (method === 'getBackgroundModelReasoning') return { reasoning: { efforts: [{ id: 'high', name: 'High' }] } }
    if (method === 'setConversationBackgroundConfig' && fail) throw Error('保存失败测试')
    if (method === 'getConversationBackgroundConfig' || method === 'setConversationBackgroundConfig') {
      if (method === 'setConversationBackgroundConfig') model = args.backgroundModel
      return { backgroundModel: model, backgroundTasks: { variables: true, posture: true }, modelCatalog: [{ provider: 'p', models: [{ id: 'm', name: '测试模型' }] }] }
    }
  } })
  const name = page.getByLabel('玩家称呼', { exact: true })
  await name.fill('旅人')
  await name.press('Tab')
  await page.waitForFunction(() => document.querySelector('.dsh-local-field input')?.disabled === false)
  assert.equal(playerName, '旅人')
  await page.getByLabel('本局预设', { exact: true }).selectOption('presets/one.json')
  await page.waitForFunction(() => document.querySelector('[aria-label="本局预设"]')?.disabled === false)
  assert.equal(preset.id, 'presets/one.json')
  const select = page.getByLabel('本局后台模型', { exact: true })
  const choice = JSON.stringify({ provider: 'p', model: 'm' })
  await select.selectOption(choice)
  await page.waitForFunction(() => document.querySelector('[aria-label="本局后台模型"]')?.disabled === false)
  assert.deepEqual(model, { provider: 'p', model: 'm' })
  fail = true
  await select.selectOption('')
  await page.getByRole('alert').filter({ hasText: '保存失败测试' }).waitFor()
  assert.equal(await select.inputValue(), choice)
  for (const call of calls.filter(call => ['setPlayerName', 'applyConversationPreset', 'setConversationBackgroundConfig'].includes(call.method))) {
    assert.equal(call.args.sessionId, 'game')
  }
})
