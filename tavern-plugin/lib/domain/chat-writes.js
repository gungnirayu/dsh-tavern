// Persistence owns conflict detection and revisions. This module owns the work
// triggered by a successful write, including the historical per-writer policy.
export function createChatWrites({ persistence, isDeleted, candidatesChanged, syncSummary, publish, syncTemplates, queueCompaction }) {
  function assertWritable(id) {
    if (isDeleted(id)) throw new Error('对话已删除')
  }

  async function committed(kind, saved, metadata, input = saved) {
    candidatesChanged(saved, metadata)
    // A patch can lose its CAS race; an update can find no remaining Chat.
    if (kind === 'patch' && !saved) return saved
    const source = String(metadata?.source || '')
    const mailbox = source.startsWith('candidate.mailbox.')
    if (kind === 'header' || kind === 'update' || !mailbox) {
      // Header writes refresh the caller's draft, including its full history.
      // Their returned value may be only a projection; the summary needs input.
      await syncSummary(kind === 'header' ? input : saved)
    }
    if (saved === undefined) return saved
    void publish(saved.sessionId)
    // A Skill switch changes future availability, not story/template data.
    if (kind !== 'update' || source !== 'writing-skill.switch') {
      syncTemplates(saved, metadata)
      // Header/patch writers historically schedule even for compaction sources.
      if (kind === 'header' || kind === 'patch' || !source.startsWith('compaction.')) {
        queueCompaction(saved.sessionId)
      }
    }
    return saved
  }

  // Import/restore callers deliberately persist without notifying live consumers.
  async function writeRaw(chat, metadata) {
    assertWritable(chat.id)
    return await persistence.write(chat, metadata)
  }

  async function write(chat, metadata) {
    return committed('write', await writeRaw(chat, metadata), metadata)
  }

  async function writeHeader(chat, baseline, metadata) {
    assertWritable(chat.id)
    return committed('header', await persistence.writeHeader(chat, baseline, metadata), metadata, chat)
  }

  async function update(id, mutation, metadata) {
    assertWritable(id)
    return committed('update', await persistence.update(id, mutation, metadata), metadata)
  }

  async function patch(id, revision, changes, metadata) {
    assertWritable(id)
    return committed('patch', await persistence.patch(id, revision, changes, metadata), metadata)
  }

  return Object.freeze({ write, writeHeader, update, patch, writeRaw })
}
