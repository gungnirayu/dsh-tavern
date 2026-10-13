import { isScopedMessages } from './scoped-messages.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { randomUUID } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { createRoundAnchorResolver, validAnchor } from './round-anchor.js'

const body = message => String(message?.text ?? '')
const textOf = message => (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n')

// A player row is followed by its round's reply row, which records where the
// round's input sits natively (round-anchor.js). Rows saved before anchors
// existed fall back to matching by text.
function anchoredInputs(events, nodes) {
  let resolve = null
  return function anchoredInput(messages, index) {
    const anchor = messages[index]?.role === 'user' ? messages[index + 1]?.nativeAnchor : null
    if (!validAnchor(anchor)) return -1
    resolve ??= createRoundAnchorResolver({ events, nodes: nodes.map(event => event.seq) })
    const resolved = resolve(anchor)
    const at = resolved && resolved.input !== null ? nodes.findIndex(event => event.seq === resolved.input) : -1
    return at >= 0 && nodes[at].type === 'user/message' ? at : -1
  }
}

/** Journal a template rewrite against its exact existing native message; never edit old events. */
export function prepareTemplateHistory(session, before, after) {
  const events = sessionEvents(session), bySeq = new Map(events.map(event => [event.seq, event]))
  const nodes = (session.surface?.nodes || []).map(seq => bySeq.get(seq)).filter(Boolean)
  const anchoredInput = anchoredInputs(events, nodes)
  // Index each active message once. Archived/unmatched chat rows must not
  // repeatedly rescan the entire remaining surface either.
  const positions = new Map()
  const messageTypes = new Set(before.messages.map(message => message.role + '/message'))
  nodes.forEach((event, offset) => {
    if (!messageTypes.has(event.type)) return
    const key = event.type + '\0' + textOf(event.type === 'assistant/message' ? event.data.message : event.data)
    if (!positions.has(key)) positions.set(key, [])
    positions.get(key).push(offset)
  })
  function firstAtOrAfter(offsets, cursor) {
    if (!offsets) return -1
    let lo = 0, hi = offsets.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (offsets[mid] < cursor) lo = mid + 1
      else hi = mid
    }
    return offsets[lo] ?? -1
  }
  let cursor = 0
  for (let index = 0; index < before.messages.length; index++) {
    const old = before.messages[index], next = after.messages[index]
    const texts = new Set([body(old), old.sourceText, old.sessionText, old.templateInputSource].filter(value => typeof value === 'string'))
    let at = anchoredInput(before.messages, index)
    if (at < 0) for (const text of texts) {
      const candidate = firstAtOrAfter(positions.get(old.role + '/message\0' + text), cursor)
      if (candidate >= 0 && (at < 0 || candidate < at)) at = candidate
    }
    if (at >= 0) cursor = at + 1
    const inputRewrite = old.templateInputSource && at >= 0 && textOf(nodes[at].data) !== body(next)
    if (body(old) === body(next) && !inputRewrite) continue
    // Archived messages outside the active surface have no native message to replace.
    if (at < 0) continue
    const target = nodes[at]
    next.templateHistoryEdit = { id: 'tavern-template-edit:' + randomUUID(), seq: target.seq, role: old.role,
      turn: target.data.turn || next.turn || 1 }
  }
  return after
}

/** Bounded history: align its contiguous recent rows from the end of the surface. */
function markRecentInputRewrites(session, messages) {
  const events = sessionEvents(session), bySeq = new Map(events.map(event => [event.seq, event]))
  const nodes = (session.surface?.nodes || []).map(seq => bySeq.get(seq)).filter(Boolean)
  const anchoredInput = anchoredInputs(events, nodes)
  let cursor = nodes.length - 1
  for (let index = messages.length - 1; index >= 0 && Object.hasOwn(messages, String(index)); index--) {
    const message = messages[index]
    const texts = new Set([body(message), message.sourceText, message.sessionText, message.templateInputSource].filter(value => typeof value === 'string'))
    let at = anchoredInput(messages, index)
    if (at < 0) for (let offset = cursor; offset >= 0; offset--) {
      const event = nodes[offset]
      if (event.type !== message.role + '/message') continue
      if (texts.has(textOf(event.type === 'assistant/message' ? event.data.message : event.data))) { at = offset; break }
    }
    if (at < 0) continue
    cursor = at - 1
    if (!message.templateInputSource || textOf(nodes[at].data) === body(message)) continue
    message.templateHistoryEdit = { id: 'tavern-template-edit:' + randomUUID(), seq: nodes[at].seq, role: message.role,
      turn: nodes[at].data.turn || message.turn || 1 }
  }
}

export async function synchronizeTemplateHistory(session, chat, flush) {
  if (isScopedMessages(chat.messages)) markRecentInputRewrites(session, chat.messages)
  else prepareTemplateHistory(session, chat, chat)
  const events = sessionEvents(session)
  const ids = new Set(events.map(event => event.type === 'assistant/message' ? event.data.message?.id : event.data?.id))
  let changed = false
  for (const message of chat.messages || []) {
    const edit = message?.templateHistoryEdit
    if (!edit || ids.has(edit.id) || !session.surface?.nodes.includes(edit.seq)) continue
    const target = events.find(event => event.seq === edit.seq)
    const original = target.type === 'assistant/message' ? target.data.message : target.data
    let replaced = false
    const content = original.content.flatMap(block => {
      if (block.type !== 'text') return [block]
      if (replaced) return []
      replaced = true; return [{ type: 'text', text: body(message) }]
    })
    if (!replaced) content.push({type:'text',text:body(message)})
    const replacement = { ...original, id: edit.id, content }
    replaceSessionSurface(session, edit.role + '/message', edit.role === 'assistant' ? { turn: edit.turn, step: 1, message: replacement } : replacement,
      { start: edit.seq, end: edit.seq, sourceEventSeqs: [edit.seq] })
    changed = true
  }
  if (changed) await flush(session)
}
