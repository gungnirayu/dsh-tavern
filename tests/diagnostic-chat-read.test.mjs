import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createMaintenanceHandlers } from '../tavern-plugin/lib/rpc/maintenance.js'

for (const method of ['recordMvuRuntimeDiagnostic', 'recordTavernCompatibilityCalls']) {
  test(`${method} does not clone historical variable snapshots`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'diagnostic-chat-read-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const store = createChatJournalStore({ dataRoot: root })
    await store.update('chat', () => ({ id: 'chat', sessionId: 'canonical', _storageRevision: 1,
      messages: Array.from({ length: 458 }, (_, turn) => ({ role: 'assistant', turn,
        variables: [{ stat_data: { entries: Array.from({ length: 100 }, () => ({ value: 'saved variable' })) } }] })) }))
    const rows = []
    let fullCopies = 0
    const clone = globalThis.structuredClone
    t.mock.method(globalThis, 'structuredClone', value => {
      if (value?.messages?.some(message => message.variables)) fullCopies++
      return clone(value)
    })
    const context = { str: String,
      chatHeaderForSession: id => id === 'missing' ? undefined : store.readSessionState('chat'),
      chatForSession: id => id === 'missing' ? undefined : store.read('chat'),
      sessionStateForSession: id => id === 'missing' ? undefined : store.readSessionState('chat'),
      mvuDiagnostics: { record: async (...args) => rows.push(args) },
      compatibilityDiagnostics: { record: async (...args) => rows.push(args) } }
    const handlers = createMaintenanceHandlers(context)
    const invoke = args => handlers[method](args)
    for (let i = 0; i < 6; i++) {
      assert.equal((await invoke({ sessionId: 'alias', runtimeId: 'runtime', calls: [],
        diagnostic: { kind: 'mvu-load', phase: 'initialization-waiting' } })).recorded, true)
    }
    assert.equal(rows.length, 6)
    assert.ok(rows.every(row => row[0] === 'canonical'))
    await assert.rejects(invoke({ sessionId: 'missing' }), /没有绑定/)
    assert.equal(fullCopies, 0, 'diagnostics must not clone the full chat')
  })
}
