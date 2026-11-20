import type { Thread } from '../types'
import type { Shape } from './kinds'
import type { Bundle } from './mailbox'
import type { BundleCategory } from './views'

/** One card in "opening the mail": a letter, and the bundle it was tied in, if any. */
export type RitualItem = { id: string; bundle?: BundleCategory }

/**
 * What the postman brought, in the order it is opened: people first, then codes, parcels
 * and receipts, then the letters of each bundle. Every letter is a card of its own, so each
 * gets its own decision.
 */
export function ritualQueue(threads: Thread[], bundles: Bundle[], shapeOf: (thread: Thread) => Shape): RitualItem[] {
  const fresh = (thread: Thread) => thread.unread && thread.labelIds.includes('INBOX')
  const quick = (thread: Thread) => ['code', 'parcel', 'receipt'].includes(shapeOf(thread).kind)
  const people = threads.filter((thread) => fresh(thread) && !quick(thread))
  const cards = [...threads, ...bundles.flatMap((bundle) => bundle.threads)].filter((thread) => fresh(thread) && quick(thread))
  const tied = bundles.flatMap((bundle) => bundle.threads.filter((thread) => fresh(thread) && !quick(thread)).map((thread): RitualItem => ({ id: thread.id, bundle: bundle.category })))
  const seen = new Set<string>()
  const first = (item: RitualItem) => (seen.has(item.id) ? false : (seen.add(item.id), true))
  return [...[...people, ...cards].map((thread): RitualItem => ({ id: thread.id })), ...tied].filter(first)
}

/** How many letters a queue (or what is left of it) holds. */
export const ritualSize = (queue: RitualItem[]) => queue.length
