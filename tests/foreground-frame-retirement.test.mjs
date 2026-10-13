import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'

import { retireForegroundFrames } from '../tavern-plugin/lib/domain/foreground-frame-retirement.js'

test('旧存档无 trace 的指引可清理，其他插件内容不受影响', () => {
  const session = Session.create('legacy-frames')
  for (const [id, plugin, form] of [['legacy', 'dsh-tavern', 'foreground-frame'], ['foreign', 'other', 'foreground-frame'], ['snapshot', 'dsh-tavern', 'snapshot']]) {
    session.append('user/message', { id, role: 'user', content: [{ type: 'text', text: id }], source: { kind: 'plugin', plugin, form } }, { surfaceOp: 'append' })
  }
  assert.equal(retireForegroundFrames(session, { keepTurn: 3 }), 1)
  const text = JSON.stringify(session.deriveMessages().map(message => message.content))
  assert.doesNotMatch(text, /legacy/)
  assert.match(text, /foreign/); assert.match(text, /snapshot/)
})
