// "A turn's background settlement finished": the settlement job announces it, and
// whatever follows a settled turn (save maintenance, MVU wake-ups, world book
// warm-up, plugins, game titles) subscribes, so the settlement names none of them.
// `latest` is the save's header after the turn, or null when it could not be read.
export function createTurnSettledEvents({ logger = console } = {}) {
  const listeners = new Set()

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  // Fire and forget: one failing follower never keeps the others from running.
  function emit(event) {
    for (const listener of listeners) {
      try {
        const pending = listener(event)
        if (pending && typeof pending.catch === 'function') pending.catch(error => logger.warn('dsh-tavern: 结算后续处理失败:', error?.message || error))
      } catch (error) { logger.warn('dsh-tavern: 结算后续处理失败:', error?.message || error) }
    }
  }

  return Object.freeze({ subscribe, emit })
}
