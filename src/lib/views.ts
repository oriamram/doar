import type { Category, Thread } from '../types'
import type { ListQuery } from './gmail'

/** What the list can show: a folder, one of your labels, a bundle, or search results. */
export type FolderId = 'inbox' | 'unread' | 'starred' | 'sent' | 'drafts' | 'scheduled' | 'held' | 'waiting' | 'archive' | 'all' | 'spam' | 'trash'
export type BundleCategory = Exclude<Category, 'primary'>

export type View =
  | { kind: 'folder'; id: FolderId }
  | { kind: 'label'; id: string; name: string }
  | { kind: 'bundle'; category: BundleCategory }
  | { kind: 'search'; query: string }

export const INBOX: View = { kind: 'folder', id: 'inbox' }

/** The kinds of mail tied into bundles, in the order they're checked. */
export const BUNDLE_CATEGORIES: BundleCategory[] = ['updates', 'promotions', 'social', 'forums']

export const FOLDER_TITLES: Record<FolderId, string> = {
  inbox: 'דואר נכנס',
  unread: 'דואר נכנס',
  starred: 'מסומנים בכוכב',
  sent: 'נשלחו',
  drafts: 'טיוטות',
  scheduled: 'מתוזמנים',
  held: 'שמורים',
  waiting: 'ממתינים לתשובה',
  archive: 'מתויקים',
  all: 'כל הדואר',
  spam: 'ספאם',
  trash: 'אשפה',
}

export const BUNDLE_TITLES: Record<BundleCategory, string> = {
  updates: 'עדכונים',
  promotions: 'פרסומות',
  social: 'רשתות חברתיות',
  forums: 'פורומים',
}

export function viewKey(view: View): string {
  switch (view.kind) {
    case 'folder':
      return view.id
    case 'label':
      return `label:${view.id}`
    case 'bundle':
      return `bundle:${view.category}`
    case 'search':
      return `search:${view.query}`
  }
}

/** The last part of a nested label's name ("Travels/Cyprus" → "Cyprus"). */
export const labelLeaf = (name: string) => name.split('/').at(-1) ?? name

export function viewTitle(view: View): string {
  switch (view.kind) {
    case 'folder':
      return FOLDER_TITLES[view.id]
    case 'label':
      return labelLeaf(view.name)
    case 'bundle':
      return BUNDLE_TITLES[view.category]
    case 'search':
      return 'חיפוש'
  }
}

const NOT_BUNDLED = BUNDLE_CATEGORIES.map((category) => `-category:${category}`).join(' ')

/** The Gmail request behind a view. With bundles on, the inbox leaves bundled mail out. */
export function viewQuery(view: View, bundles: boolean): ListQuery {
  switch (view.kind) {
    case 'label':
      return { labelIds: [view.id] }
    case 'bundle':
      return { q: `in:inbox category:${view.category}` }
    case 'search':
      return { q: view.query }
    case 'folder':
      switch (view.id) {
        case 'inbox':
          return bundles ? { q: `in:inbox ${NOT_BUNDLED}` } : { labelIds: ['INBOX'] }
        case 'unread':
          return { q: 'in:inbox is:unread' }
        case 'starred':
          return { labelIds: ['STARRED'] }
        case 'sent':
          return { labelIds: ['SENT'] }
        case 'drafts':
        // These lists come from Doar's server, not from this request (see mailbox.ts).
        case 'scheduled':
        case 'held':
        case 'waiting':
          return { labelIds: ['DRAFT'] }
        case 'archive':
          // Mail you received and filed: out of the inbox, not deleted.
          return { q: '-in:inbox -in:sent -in:drafts -in:chats' }
        case 'all':
          return {}
        case 'spam':
          return { labelIds: ['SPAM'], includeSpamTrash: true }
        case 'trash':
          return { labelIds: ['TRASH'], includeSpamTrash: true }
      }
  }
}

/**
 * A conversation can hold mail of several kinds; it's shown where its latest
 * message belongs, so it never appears both in the inbox and in a bundle.
 */
export function belongsInView(view: View, thread: Thread, bundles: boolean): boolean {
  if (view.kind === 'bundle') return thread.category === view.category
  if (view.kind === 'folder' && view.id === 'inbox' && bundles) return thread.category === 'primary'
  // A conversation with an old filed letter and a new one in the inbox still belongs to the inbox.
  if (isFolder(view, 'archive')) return !thread.labelIds.includes('INBOX')
  return true
}

export const isFolder = (view: View, id: FolderId) => view.kind === 'folder' && view.id === id

/** Views that only show mail still in the inbox, so filing a letter takes it off the list. */
export function isInboxLike(view: View): boolean {
  return view.kind === 'bundle' || isFolder(view, 'inbox') || isFolder(view, 'unread')
}
