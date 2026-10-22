import test from 'node:test'
import assert from 'node:assert/strict'

import { createBackgroundSessionRetirement, installRetiredCatalogView } from '../tavern-plugin/lib/domain/background-session-retirement.js'

test('旧版本失败记录仅在被新会话替代后折叠，回退到旧参与者时恢复可见',async()=>{
  const chat={timeline:{participants:{background:{sessionId:'new'}},operations:{a:{kind:'agent',status:'failed',startedSessionId:'old'},b:{kind:'agent',status:'running',startedSessionId:'busy'}}}}
  const retirement=createBackgroundSessionRetirement({readJson:async()=>undefined},{readState:async()=>chat})
  const rows=['old','new','busy','unrelated'].map(id=>({kind:'child',id,label:'酒馆后台 Agent',activity:'inactive'}))
  assert.deepEqual((await retirement.filter(rows,'parent')).map(row=>row.id),['new','busy','unrelated'])
  chat.timeline.participants.background.sessionId='old'
  assert.equal((await retirement.filter(rows,'parent')).length,4)
})

// Public summaries also feed the native header count. Keep ancestors and live
// workers discoverable even when their retirement record already exists.

// DSH 0.2 reads the header count and popup from the subagentCatalog projection view.
test('子智能体目录投影：已退休的后台 Agent 不再列出，运行中的照常显示；先登记或后登记都生效', async () => {
  let saved = { gone: { parentId: 'game' } }
  const store = { readJson: async () => saved, updateJson: async (_path, update) => { saved = update(saved) } }
  const retirement = createBackgroundSessionRetirement(store)
  await retirement.load()
  const rows = ['gone', 'busy', 'current'].map(id => ({ id, createdAt: 1, mode: 'continuable', label: '酒馆后台 Agent' }))
  const view = () => rows
  const running = new Set()
  const options = { isRunning: id => running.has(id) }

  const registered = { registrations: new Map([['subagentCatalog', { def: { wire: { view } } }]]) }
  const undo = installRetiredCatalogView(registered, retirement, options)
  const read = () => registered.registrations.get('subagentCatalog').def.wire.view({}).map(row => row.id)
  assert.deepEqual(read(), ['busy', 'current'])
  await retirement.retire('busy', 'game')
  assert.deepEqual(read(), ['current'])
  running.add('busy')
  assert.deepEqual(read(), ['busy', 'current'], 'a running worker is never hidden')
  undo()
  assert.deepEqual(read(), ['gone', 'busy', 'current'])

  const definitions = []
  const later = { registrations: new Map(), register(definition) { definitions.push(definition) } }
  installRetiredCatalogView(later, retirement, options)
  later.register({ key: 'other', wire: { view } })
  later.register({ key: 'subagentCatalog', wire: { view } })
  assert.equal(definitions[0].wire.view({}).length, 3, 'other projections are left alone')
  assert.deepEqual(definitions[1].wire.view({}).map(row => row.id), ['busy', 'current'])
})
