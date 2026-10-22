import { projectAgentContent } from './runtime-content-projection.js'
import { historyScanDepth } from './worldbook-activation.js'
import { mvuUpdateRulesFromWorldBook } from './worldbook-recall.js'
import { withPluginWorldbookEntries } from './plugin-worldbook.js'

// The world book a game plays with, as the background and recall read it.
export function createPlayWorldBook({ worldBooks, readChatCard, pluginApi }) {
  async function mvuUpdateRules(chat, card) {
    try {
      const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
      return mvuUpdateRulesFromWorldBook(worldBook).map(function (rule) {
        return projectAgentContent(rule, { charName: card && card.name, macroState: chat.macroState }).agentText
      })
    } catch (_error) {
      return []
    }
  }
  // An unreadable book has no known depth: callers then use the complete read.
  async function worldBookScanDepth(chat) {
    try { return historyScanDepth(await worldBooks.bound(chat.cardPath, await readChatCard(chat), chat)) }
    catch { return Infinity }
  }
  // What recall, world book search and screening read: the bound book plus plugin entries (tavern.worldbookEntries).
  async function playWorldBook(chat, card) {
    const record = await worldBooks.bound(chat.cardPath, card, chat)
    if (!chat?.sessionId) return record
    const turn = Number([...(chat.messages || [])].reverse().find(message => message?.role === 'assistant')?.turn) || 0
    return withPluginWorldbookEntries(record, await pluginApi.worldbookPoolEntries({ gameId: chat.sessionId, turn }))
  }

  return { playWorldBook, worldBookScanDepth, mvuUpdateRules }
}
