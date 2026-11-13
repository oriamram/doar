// Held mail ("bring this letter back later") and registered mail ("tell me if nobody
// answers"). Pure functions, used by the Edge Function and checked by scripts/check-postman.ts.

/** What Gmail says about a conversation: just ids, labels and times. */
export type ThreadFacts = { messages?: { id: string; labelIds?: string[]; internalDate?: string }[] }

/**
 * Has anyone answered since this sent message?
 * "gone" means the message is no longer in the conversation (deleted), so there is nothing to wait for.
 */
export function replyState(thread: ThreadFacts, afterMessageId: string): 'answered' | 'waiting' | 'gone' {
  const messages = thread.messages ?? []
  const index = messages.findIndex((message) => message.id === afterMessageId)
  if (index < 0) return 'gone'
  const sentAt = Number(messages[index]!.internalDate ?? 0)
  const answered = messages.some((message, position) => {
    const labels = message.labelIds ?? []
    // Mail the person sent (also to themselves) and unsent drafts are not answers.
    if (labels.includes('SENT') || labels.includes('DRAFT') || labels.includes('TRASH') || labels.includes('SPAM')) return false
    const at = Number(message.internalDate ?? 0)
    return at > sentAt || (at === sentAt && position > index)
  })
  return answered ? 'answered' : 'waiting'
}

/** A time the app asked for, if it is sane: from a little while from now up to a year ahead. */
export function validDue(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  if (Number.isNaN(time) || time < now + 20_000 || time > now + 366 * 86_400_000) return null
  return new Date(time).toISOString()
}

/** How many days to wait for an answer, if it is sane (1 to 60). */
export function validDays(value: unknown): number | null {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 60 ? days : null
}
