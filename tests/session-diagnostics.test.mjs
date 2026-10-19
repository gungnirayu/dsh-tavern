import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { encodeMigratedSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'
import { exportSessionDiagnostics } from '../tavern-plugin/lib/domain/session-diagnostics.js'

const sessionId = '019a0000-0000-7000-8000-000000000001'
const parsed = {
  header: { type: 'session', version: 3, id: sessionId, cwd: '/Users/玩家/私密路径', agentPreset: 'tavern' },
  events: [
    { seq: 0, time: 1, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '秘密剧情' }] } }, surfaceOp: 'append' },
    { seq: 1, time: 1, type: 'assistant/message', data: { turn: 1, step: 1, stream: [], message: { role: 'assistant', content: [{ type: 'tool_call', id: 'c1', name: 'edit', arguments: '{"text":"秘密"}' }] } }, surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 }, sourceEventSeqs: [0] },
  ],
}

test('诊断文件保留会话日志结构、抹掉正文和路径，坏档按原因列出', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-diagnostics-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'project', sessionId)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'session.v3.jsonl.zstd'), encodeMigratedSessionLog(JSON.stringify(parsed.header), parsed.events))
  await writeFile(path.join(directory, 'session.v4.jsonl.zstd'), 'damaged')
  const report = await exportSessionDiagnostics({ sessionsRoot: root, sessionIds: [sessionId, '019a0000-0000-7000-8000-000000000002'], errorOf: id => id === sessionId ? 'step/start does not match' : undefined, tavernVersion: '3.0.0' })
  const text = JSON.stringify(report)
  assert.doesNotMatch(text, /秘密|私密路径/)
  const [session, missing] = report.sessions
  assert.equal(session.upgradeError, 'step/start does not match')
  const [v3, v4] = session.generations
  assert.equal(v3.file, 'session.v3.jsonl.zstd')
  assert.equal(v3.header.cwd, '/redacted')
  assert.deepEqual(v3.events.map(event => [event.seq, event.type, event.surfaceOp, event.sourceEventSeqs]), parsed.events.map(event => [event.seq, event.type, event.surfaceOp, event.sourceEventSeqs]))
  assert.equal(v3.events[0].data.message.content[0].text, '«4 chars»')
  assert.doesNotThrow(() => JSON.parse(v3.events[1].data.message.content[0].arguments), 'tool arguments stay valid JSON for the upgrader')
  assert.equal(v4.file, 'session.v4.jsonl.zstd')
  assert.ok(v4.unreadable)
  assert.ok(missing.missing)
})
