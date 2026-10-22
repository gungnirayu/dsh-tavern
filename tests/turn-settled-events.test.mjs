import assert from 'node:assert/strict'
import test from 'node:test'
import { createTurnSettledEvents } from '../tavern-plugin/lib/domain/turn-settled-events.js'

test('every follower hears a settled turn even when another one throws or rejects; unsubscribe stops it', async () => {
  const warnings = [], heard = []
  const events = createTurnSettledEvents({ logger: { warn: (...args) => warnings.push(args.join(' ')) } })
  events.subscribe(() => { throw new Error('同步失败') })
  events.subscribe(async () => { throw new Error('异步失败') })
  const stop = events.subscribe(event => { heard.push(event.chatId) })
  events.emit({ chatId: 'a', latest: { sessionId: 's' } })
  stop()
  events.emit({ chatId: 'b', latest: null })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(heard, ['a'])
  assert.equal(warnings.filter(line => line.includes('同步失败')).length, 2)
  assert.equal(warnings.filter(line => line.includes('异步失败')).length, 2)
})
