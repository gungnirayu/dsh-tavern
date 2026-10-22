import assert from 'node:assert/strict'
import test from 'node:test'
import { createResourceHandlers } from '../tavern-plugin/lib/rpc/resources.js'

// Exercise the production RPC handler with isolated persistence and resource dependencies.
function harness({ busy = false, stale = false, touched = false } = {}) {
  let chat = { id: 'game', mode: 'story', _storageRevision: 1, messages: Array.from({ length: 200 }, (_, turn) => ({ turn })), variables: { hp: 7 }, runtimePresetSnapshot: { presetPath: 'old' } }
  let reads = 0
  const snapshot = { presetPath: 'new', front: { text: 'front' }, middle: { text: 'middle' }, back: { text: 'back' }, regexScripts: [{ findRegex: 'a', replaceString: 'b' }] }
  return {
    chat: () => chat, reads: () => reads, snapshot,
    apply: path => createResourceHandlers({
      str: String, chatForSession: async () => structuredClone(chat), groupOfMode: () => 'play',
      sessionActivity: async () => ({ busy }), agentRegistry: new Map(),
      runtimePresets: { fullSnapshot: async () => { reads++; return structuredClone(snapshot) } },
      updateChat: async (_id, update) => { const draft = structuredClone(chat); if (stale) { draft._storageRevision++; draft.messages.push({ turn: 200 }) } if (touched) draft._storageRevision++; chat = update(draft); return chat }
    }).applyConversationPreset({ sessionId: 'session', path })
  }
}

test('busy and stale games reject preset replacement without changing the save', async () => {
  for (const options of [{ busy: true }, { stale: true }]) {
    const h = harness(options)
    const before = structuredClone(h.chat())
    await assert.rejects(h.apply('new'), /等待|已变化/)
    assert.deepEqual(h.chat(), before)
  }
})

test('a save written meanwhile without a new turn (a display receipt) still takes the preset', async () => {
  const h = harness({ touched: true })
  await h.apply('new')
  assert.equal(h.chat().runtimePresetSnapshot.presetPath, 'new')
})
