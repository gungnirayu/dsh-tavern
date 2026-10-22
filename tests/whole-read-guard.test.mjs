import test from 'node:test'
import assert from 'node:assert/strict'

import { createWholeReadGuard, scopeTurnHooks } from '../tavern-plugin/lib/domain/whole-read-guard.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 1))

test('a whole read inside a per-turn path is reported, also from work it starts', async () => {
  const guard = createWholeReadGuard({ mode: 'throw' })
  assert.doesNotThrow(() => guard.report('c'))
  await assert.rejects(guard.scope('结算', async () => { await tick(); guard.report('c') }), { code: 'DSH_TAVERN_WHOLE_READ', message: /结算/ })
  let started
  await guard.scope('agent/pre-step', async () => { started = tick().then(() => guard.report('c')) })
  await assert.rejects(started, { code: 'DSH_TAVERN_WHOLE_READ' })
})

test('allow marks a deliberate exception without leaving the path', async () => {
  const guard = createWholeReadGuard({ mode: 'throw' })
  await guard.scope('agent/pre-step', async () => {
    await guard.allow('本进程首次同步', async () => { await tick(); guard.report('c') })
    assert.throws(() => guard.report('c'))
  })
})

test('warn logs each call site once; off reports nothing', async () => {
  const warnings = []
  const guard = createWholeReadGuard({ mode: 'warn', logger: { warn: message => warnings.push(message) } })
  const read = () => guard.report('c')
  for (let i = 0; i < 3; i++) await guard.scope('结算', async () => read())
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /每轮路径读取了完整存档（结算）/)
  const off = createWholeReadGuard({ mode: 'off' })
  await off.scope('结算', async () => off.report('c'))
})

test('turn hooks run marked, streams while consumed; other events and members pass through', async () => {
  const guard = createWholeReadGuard({ mode: 'throw' })
  const handlers = new Map()
  const host = { secret: 7, get() { return this.secret }, on(event, handler) { handlers.set(event, handler); return 'off' } }
  const ctx = scopeTurnHooks(host, guard)
  assert.equal(ctx.get(), 7)
  assert.equal(ctx.on('agent/pre-step', async () => guard.active()), 'off')
  ctx.on('theme/change', () => guard.active())
  ctx.on('llm/stream', () => (async function* () { await tick(); yield guard.active() })())
  assert.equal(await handlers.get('agent/pre-step')(), true)
  assert.equal(handlers.get('theme/change')(), false)
  const seen = []
  for await (const value of handlers.get('llm/stream')()) seen.push(value)
  assert.deepEqual(seen, [true])
})

test('storage reports whole copies and whole rebuilds, not narrow reads of a cached native save', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createChatJournalStore } = await import('../tavern-plugin/lib/domain/chat-journal-store.js')
  const { createChatPersistence } = await import('../tavern-plugin/lib/domain/chat-persistence.js')
  const root = await mkdtemp(join(tmpdir(), 'whole-read-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const reported = []
  const guard = createWholeReadGuard({ mode: 'warn', minFloors: 0, logger: { warn: message => reported.push(message) } })
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true, wholeReadGuard: guard }) })
  await p.write({ id: 'c', sessionId: 's', mode: 'story', messages: [{ role: 'user', text: 'u' }, { role: 'assistant', text: 'a' }] }, { source: 'create' })
  await p.read('c')
  await guard.scope('结算', async () => {
    await p.readSlice('c', [1], ['mode'])
    await p.readBackgroundConfig('c')
    const revision = (await p.readSlice('c', [])).chat._storageRevision
    await p.patch('c', revision, [{ op: 'set', path: ['messages', 1, 'text'], value: 'b' }], { source: 'test' })
  })
  assert.deepEqual(reported, [])
  await guard.scope('结算', () => p.read('c'))
  assert.equal(reported.length, 1)
})
