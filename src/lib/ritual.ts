import type { Thread } from '../types'
import type { Shape } from './kinds'
import type { Bundle } from './mailbox'
import type { BundleCategory } from './views'

/** One stop in "opening the mail": a letter to read, or a whole bundle to decide about at once. */
export type RitualItem = { kind: 'letter'; id: string } | { kind: 'bundle'; category: BundleCategory; ids: string[] }

/**
 * What the postman brought, in the order it is opened: people first, then codes,
 * parcels and receipts, then each bundle as one decision.
 */
export function ritualQueue(threads: Thread[], bundles: Bundle[], shapeOf: (thread: Thread) => Shape): RitualItem[] {
  const fresh = (thread: Thread) => thread.unread && thread.labelIds.includes('INBOX')
  const quick = (thread: Thread) => ['code', 'parcel', 'receipt'].includes(shapeOf(thread).kind)
  const people = threads.filter((thread) => fresh(thread) && !quick(thread))
  const cards = [...threads, ...bundles.flatMap((bundle) => bundle.threads)].filter((thread) => fresh(thread) && quick(thread))
  const tied = bundles
    .map((bundle) => ({ category: bundle.category, ids: bundle.threads.filter((thread) => fresh(thread) && !quick(thread)).map((thread) => thread.id) }))
    .filter((bundle) => bundle.ids.length > 0)
  const seen = new Set<string>()
  const letters = [...people, ...cards].filter((thread) => (seen.has(thread.id) ? false : (seen.add(thread.id), true)))
  return [...letters.map((thread): RitualItem => ({ kind: 'letter', id: thread.id })), ...tied.map((bundle): RitualItem => ({ kind: 'bundle', ...bundle }))]
}

/** How many letters a queue (or what is left of it) holds. */
export const ritualSize = (queue: RitualItem[]) => queue.reduce((sum, item) => sum + (item.kind === 'letter' ? 1 : item.ids.length), 0)
