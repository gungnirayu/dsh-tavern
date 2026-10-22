import { projectAgentContent, projectAgentMessageText } from './runtime-content-projection.js'

// What one background settlement reads from the latest round and writes back to the save.

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// `knownPosture`: the posture the background history already shows; the block is
// repeated only when that differs (new session, compaction, rewind).
export function settleUserText(chat, includePosture = true, knownPosture = '') {
  const msgs = (chat.messages || []).filter(function (message) {
    return message && (message.role === 'user' || message.role === 'assistant')
  }).slice(-2)
  const repeatPosture = includePosture && !(str(chat.posture).trim() !== '' && str(chat.posture).trim() === knownPosture)
  const lines = [
    ...(repeatPosture ? ['【上一轮结算姿势】',
    str(chat.posture) !== '' ? projectAgentContent(chat.posture, { charName: chat.cardName, macroState: chat.macroState }).agentText : '（无）'] : []),
    '【最新一轮对话】'
  ]
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m === null || typeof m !== 'object') continue
    const text = projectAgentMessageText(m, { charName: chat.cardName, macroState: chat.macroState })
    if (text.trim() === '') continue
    lines.push((m.role === 'assistant' ? '正文' : '玩家') + ': ' + text)
  }
  return lines.join('\n')
}
export function applySettlement(chat, result) {
  let postureUpdated = false
  const posture = str(result.posture).trim()
  if (posture !== '') {
    chat.posture = posture
    postureUpdated = true
  }
  return { postureUpdated: postureUpdated }
}
export function pendingMvuTarget(chat) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
    const message = messages[messageId]
    if (!message || message.role !== 'assistant' || !message.mvu || message.mvu.pending !== true) continue
    const swipeId = Math.max(0, Number(message.swipeId) || 0)
    const variables = message.mvuBaseline?.swipeId === swipeId ? message.mvuBaseline.variables : (Array.isArray(message.variables) ? message.variables[swipeId] : undefined)
    return {
      messageId,
      swipeId,
      message,
      variables: variables && typeof variables === 'object' ? structuredClone(variables) : {}
    }
  }
  return null
}
