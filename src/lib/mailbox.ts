import { useSyncExternalStore } from 'react'
import type { ComposeDraft, Contact, Label, Message, Thread } from '../types'
import { shortName } from './addresses'
import { eraseAccount, signOut } from './auth'
import { draftFromMessage, replyDraft } from './compose'
import { isDemo } from './demo'
import { harvestRecipients, rememberContacts } from './contacts'
import { formatDay, formatWhen } from './format'
import * as api from './gmail'
import { KIND_NAMES, type Kind } from './kinds'
import { buildMime } from './mime'
import { peekGoogleAccessToken, ReauthRequiredError } from './googleToken'
import { onLaunch, takeShared, type LaunchIntent } from './launch'
import { tapHaptic } from './platform'
import * as postman from './postman'
import { forgetPush, syncPush } from './push'
import { report } from './report'
import { applyShared, getSettings, updateSettings } from './settings'
import { playSound } from './sound'
import { dismissToast, toast } from './toast'
import {
  belongsInView,
  BUNDLE_CATEGORIES,
  INBOX,
  isFolder,
  isInboxLike,
  viewKey,
  viewQuery,
  type BundleCategory,
  type View,
} from './views'

/**
 * The mailbox: what's on screen and everything you can do to your mail.
 *
 * Actions change the screen at once and then tell Gmail; if Gmail refuses,
 * the list reloads to show the truth. Most actions can be undone for a few seconds.
 */

/** Mail of one kind (updates, promotions…) tied together in the inbox. */
export type Bundle = { category: BundleCategory; threads: Thread[]; more: boolean }

/** A letter waiting for its time, with who it's for and what it's about once Gmail has told us. */
export type Scheduled = postman.ScheduledSend & { to?: Contact[]; subject?: string }

export type MailboxState = {
  me: Contact
  view: View
  /** The list on screen; null until its first load. */
  threads: Thread[] | null
  nextPageToken?: string
  /** How many pages of the list are loaded. */
  pages: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  /** Unread conversations in the whole inbox. */
  unread: number
  draftCount: number
  labels: Label[]
  bundles: Bundle[]
  /** The conversation being read. */
  open: Thread | null
  /** Bumped when the open conversation's messages must be fetched again. */
  openRevision: number
  selection: ReadonlySet<string>
  /** Mail that came in since the last check, for a small entrance. */
  arrived: ReadonlySet<string>
  compose: ComposeDraft | null
  /** Changes for every new compose form, so each starts clean. */
  composeKey: number
  /** A letter on its way out (drives the send animation). */
  flight: { to: string } | null
  /** Letters waiting to be sent later, the soonest first. */
  scheduled: Scheduled[]
  /** Automatic labels: which sender gets which label. */
  rules: postman.LabelRule[]
  /** Held letters and registered letters the server is keeping time for (and ones it just brought back). */
  reminders: postman.Reminder[]
  /** Senders you marked: express, or refused. */
  marks: postman.SenderMark[]
  /** Your notes, by conversation. */
  notes: Readonly<Record<string, string>>
  /** Opening hours for notifications; null when they may always arrive. */
  hours: postman.Hours | null
  /** Letters being returned to their sender right now: the stamp is on, and "undo" is still open. */
  returning: ReadonlySet<string>
  /** What Doar's server last said about itself; null until it has answered once. */
  server: ServerInfo | null
  online: boolean
}

export type ServerInfo = {
  /** Did the last attempt to ask it succeed? */
  reachable: boolean
  /** When it answered (milliseconds since 1970). */
  askedAt: number
  /** When it last looked for new mail. */
  lookedAt: string | null
  devices: postman.Device[]
  lastReport: postman.ServerStatus['lastReport']
}

const EMPTY: ReadonlySet<string> = new Set()
const POLL_MS = 90_000
/** The demo mailbox announces its own new mail, the way the service worker does for real mail. */
const DEMO_MAIL = 'doar-demo-mail'
const SAVED_VERSION = 3

function blank(me: Contact): MailboxState {
  return {
    me,
    view: INBOX,
    threads: null,
    nextPageToken: undefined,
    pages: 1,
    loading: true,
    loadingMore: false,
    error: null,
    unread: 0,
    draftCount: 0,
    labels: [],
    bundles: [],
    open: null,
    openRevision: 0,
    selection: EMPTY,
    arrived: EMPTY,
    compose: null,
    composeKey: 0,
    flight: null,
    scheduled: [],
    rules: [],
    reminders: [],
    marks: [],
    notes: {},
    hours: null,
    returning: EMPTY,
    server: null,
    online: navigator.onLine,
  }
}

let state = blank({ name: '', email: '' })
const listeners = new Set<() => void>()

function set(patch: Partial<MailboxState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMailbox(): MailboxState {
  return useSyncExternalStore(subscribe, () => state)
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const wideScreen = () => window.matchMedia('(min-width: 768px)').matches

// ---------- Remembering between visits ----------

type Saved = Pick<MailboxState, 'threads' | 'bundles' | 'unread' | 'draftCount' | 'labels'> & { v: number }
const savedKey = (email: string) => `doar:mail:${email.toLowerCase()}`

/** Lists already loaded, by view, so switching folders shows something at once. */
const viewCache = new Map<string, Pick<MailboxState, 'threads' | 'nextPageToken' | 'pages'>>()

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Keep the current list for instant folder switches, and the inbox for an instant start next time. */
function remember() {
  if (!state.threads) return
  viewCache.set(viewKey(state.view), { threads: state.threads, nextPageToken: state.nextPageToken, pages: state.pages })
  if (!isFolder(state.view, 'inbox')) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const saved: Saved = {
      v: SAVED_VERSION,
      threads: (viewCache.get('inbox')?.threads ?? []).slice(0, 40),
      bundles: state.bundles,
      unread: state.unread,
      draftCount: state.draftCount,
      labels: state.labels,
    }
    try {
      localStorage.setItem(savedKey(state.me.email), JSON.stringify(saved))
    } catch {
      // Storage is full or blocked; the next start just loads from Gmail.
    }
  }, 800)
}

/** Call once you know who is signed in; shows the last known inbox right away. */
export function initMailbox(me: Contact) {
  if (state.me.email === me.email) return
  viewCache.clear()
  state = blank(me)
  try {
    const saved = JSON.parse(localStorage.getItem(savedKey(me.email)) ?? 'null') as Saved | null
    if (saved?.v === SAVED_VERSION && saved.threads) {
      api.seedThreads([...saved.threads, ...saved.bundles.flatMap((bundle) => bundle.threads)])
      state = {
        ...state,
        threads: saved.threads,
        bundles: saved.bundles,
        unread: saved.unread,
        draftCount: saved.draftCount,
        labels: saved.labels,
      }
    }
  } catch {
    // Nothing usable saved; start empty.
  }
}

// ---------- Loading ----------

let loadSeq = 0
let lastLoadAt = 0

function fail(error: unknown) {
  if (error instanceof ReauthRequiredError) {
    void signOut()
    return
  }
  // Gmail refusing something it should accept is worth a trace; being offline or asked to slow down is not.
  if (!(error instanceof api.GmailError) || (error.status >= 400 && error.status !== 429)) report('mailbox', error)
  set({ error: errorText(error), loading: false, loadingMore: false })
}

async function loadCounts(): Promise<Pick<MailboxState, 'unread' | 'draftCount'>> {
  const [inbox, drafts] = await Promise.all([api.labelStats('INBOX'), api.labelStats('DRAFT')])
  return { unread: inbox.unread, draftCount: drafts.total }
}

async function loadBundles(): Promise<Bundle[]> {
  const pages = await Promise.all(
    BUNDLE_CATEGORIES.map((category) => api.listThreads({ q: `in:inbox category:${category}` }, undefined, 15)),
  )
  return BUNDLE_CATEGORIES.map((category, index) => ({
    category,
    threads: pages[index]!.threads.filter((thread) => thread.category === category),
    more: !!pages[index]!.nextPageToken,
  })).filter((bundle) => bundle.threads.length > 0)
}

/** Fetch the current view. A quiet load (the periodic check) shows no progress and no errors. */
async function load({ quiet = false }: { quiet?: boolean } = {}) {
  const view = state.view
  const seq = ++loadSeq
  const bundlesOn = getSettings().bundles
  const inbox = isFolder(view, 'inbox')
  if (!quiet) set({ loading: true })
  // Letters waiting to be sent are kept by Doar's server, not listed by Gmail.
  if (isFolder(view, 'scheduled')) {
    await refreshServer()
    if (seq !== loadSeq) return
    lastLoadAt = Date.now()
    set({ threads: [], nextPageToken: undefined, pages: 1, loading: false, error: null })
    return
  }
  // Held letters and registered letters: the server knows which, Gmail knows what they are.
  if (isFolder(view, 'held') || isFolder(view, 'waiting')) {
    await refreshServer()
    const kind = isFolder(view, 'held') ? 'hold' : 'reply'
    const rows = state.reminders.filter((reminder) => reminder.kind === kind && reminder.status !== 'returned')
    const found = await Promise.all(rows.map((reminder) => api.getThread(reminder.threadId).catch(() => null)))
    if (seq !== loadSeq) return
    lastLoadAt = Date.now()
    set({ threads: found.filter((thread) => thread !== null), nextPageToken: undefined, pages: 1, loading: false, error: null })
    return
  }
  try {
    const [page, counts, bundles] = await Promise.all([
      api.listThreads(viewQuery(view, bundlesOn)),
      loadCounts(),
      inbox ? (bundlesOn ? loadBundles() : Promise.resolve([])) : Promise.resolve(null),
    ])
    if (seq !== loadSeq) return
    lastLoadAt = Date.now()

    // A letter waiting for its time is shown under "scheduled", not among the drafts.
    const waiting = new Set(state.scheduled.map((item) => item.threadId))
    const fresh = page.threads.filter(
      (thread) =>
        belongsInView(view, thread, bundlesOn) && !(isFolder(view, 'drafts') && thread.messageCount === 0 && waiting.has(thread.id)),
    )
    const old = state.threads
    let threads = fresh
    let nextPageToken = page.nextPageToken
    let pages = 1
    if (old && state.pages > 1 && fresh.length > 0) {
      // Keep the older pages already scrolled into, below the refreshed first page.
      const ids = new Set(fresh.map((thread) => thread.id))
      const oldest = fresh.at(-1)!.date
      threads = [...fresh, ...old.filter((thread) => !ids.has(thread.id) && thread.date < oldest)]
      nextPageToken = state.nextPageToken
      pages = state.pages
    }

    // A letter the server brought back belongs in the inbox list however old it is (the list shows it first).
    if (inbox) {
      const have = new Set(threads.map((thread) => thread.id))
      const back = [...new Set(state.reminders.filter((reminder) => reminder.status === 'returned').map((reminder) => reminder.threadId))]
      const missing = await Promise.all(back.filter((id) => !have.has(id)).map((id) => api.getThread(id).catch(() => null)))
      if (seq !== loadSeq) return
      const extra = missing.filter((thread) => thread !== null && thread.labelIds.includes('INBOX')) as Thread[]
      if (extra.length) threads = [...threads, ...extra].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    }

    // New mail: anything newer than what was at the top before this check.
    const newest = old?.[0]?.date ?? ''
    const arrived = quiet && old ? fresh.filter((thread) => thread.date > newest) : []
    const moreUnread = quiet && counts.unread > state.unread

    const everything = [...threads, ...(bundles ?? state.bundles).flatMap((bundle) => bundle.threads)]
    set({
      threads,
      nextPageToken,
      pages,
      loading: false,
      error: null,
      ...counts,
      ...(bundles ? { bundles } : {}),
      open: state.open ? (everything.find((thread) => thread.id === state.open!.id) ?? state.open) : null,
      arrived: arrived.length ? new Set(arrived.map((thread) => thread.id)) : state.arrived,
    })
    remember()
    showUnreadCount()
    if (arrived.length || moreUnread) announce()
    rememberContacts(fresh.filter((thread) => !thread.outgoing).map((thread) => thread.from))
    prefetch(threads)
  } catch (error) {
    if (seq !== loadSeq) return
    if (quiet && state.threads && !(error instanceof ReauthRequiredError)) {
      set({ loading: false })
      return
    }
    fail(error)
  }
}

async function loadMore() {
  const token = state.nextPageToken
  if (!token || state.loadingMore || state.loading) return
  const view = state.view
  const key = viewKey(view)
  const bundlesOn = getSettings().bundles
  set({ loadingMore: true })
  try {
    const page = await api.listThreads(viewQuery(view, bundlesOn), token)
    if (viewKey(state.view) !== key) return
    const have = new Set((state.threads ?? []).map((thread) => thread.id))
    const more = page.threads.filter((thread) => belongsInView(view, thread, bundlesOn) && !have.has(thread.id))
    set({
      threads: [...(state.threads ?? []), ...more],
      nextPageToken: page.nextPageToken,
      pages: state.pages + 1,
      loadingMore: false,
    })
    remember()
  } catch (error) {
    if (viewKey(state.view) === key) fail(error)
  }
}

/** Fetch the first few conversations ahead of time, so opening them is instant. */
function prefetch(threads: Thread[]) {
  if (isFolder(state.view, 'spam') || isFolder(state.view, 'trash')) return
  setTimeout(() => {
    for (const thread of threads.slice(0, 4)) {
      if (thread.messageCount > 0) api.loadMessages(thread).catch(() => {})
    }
  }, 600)
}

function show(view: View) {
  const cached = viewCache.get(viewKey(view))
  set({
    view,
    threads: cached?.threads ?? null,
    nextPageToken: cached?.nextPageToken,
    pages: cached?.pages ?? 1,
    open: null,
    selection: EMPTY,
    arrived: EMPTY,
    error: null,
    loading: true,
    loadingMore: false,
  })
  void load()
}

async function refreshLabels() {
  try {
    set({ labels: await api.listLabels() })
    remember()
  } catch {
    // The folders still work without the label list; the next start tries again.
  }
}

let countsTimer: ReturnType<typeof setTimeout> | undefined

/** After changes settle, ask Gmail for the true counts. */
function countsSoon() {
  clearTimeout(countsTimer)
  countsTimer = setTimeout(() => {
    loadCounts().then(
      (counts) => {
        set(counts)
        showUnreadCount()
      },
      () => {},
    )
  }, 1500)
}

// ---------- Telling you about mail ----------

/** The unread count in the tab's title and on the installed app's icon. */
function showUnreadCount() {
  document.title = state.unread ? `(${state.unread}) דואר` : 'דואר'
  const badge = navigator as Navigator & {
    setAppBadge?: (count: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  const done = state.unread ? badge.setAppBadge?.(state.unread) : badge.clearAppBadge?.()
  done?.catch(() => {})
}

/** Mail arrived while the app is open. (When it's closed, the server sends a notification: see push.ts.) */
function announce() {
  playSound('paper')
}

/** You're looking at Doar now, so the notifications about this mail have done their job. */
function clearNotifications() {
  navigator.serviceWorker
    ?.getRegistration()
    .then((registration) => registration?.getNotifications())
    .then((shown) => shown?.forEach((notification) => notification.close()))
    .catch(() => {})
}

// ---------- Changing mail ----------

function lookup(ids: string[]): Thread[] {
  const all = new Map<string, Thread>()
  const sources = [state.threads ?? [], ...state.bundles.map((bundle) => bundle.threads), state.open ? [state.open] : []]
  for (const thread of sources.flat()) all.set(thread.id, thread)
  return ids.map((id) => all.get(id)).filter((thread) => thread !== undefined)
}

/** Apply a change to these conversations wherever they appear. */
function change(ids: string[], update: (thread: Thread) => Thread) {
  const targets = new Set(ids)
  const apply = (thread: Thread) => {
    if (!targets.has(thread.id)) return thread
    const next = update(thread)
    api.patchCachedThread(next)
    return next
  }
  set({
    threads: state.threads?.map(apply) ?? null,
    bundles: state.bundles.map((bundle) => ({ ...bundle, threads: bundle.threads.map(apply) })),
    open: state.open ? apply(state.open) : null,
  })
  remember()
}

/** Take these conversations off the list on screen. */
function drop(ids: string[]) {
  const targets = new Set(ids)
  const keep = (thread: Thread) => !targets.has(thread.id)
  const selection = new Set([...state.selection].filter((id) => !targets.has(id)))
  set({
    threads: state.threads?.filter(keep) ?? null,
    bundles: state.bundles
      .map((bundle) => ({ ...bundle, threads: bundle.threads.filter(keep) }))
      .filter((bundle) => bundle.threads.length > 0),
    selection: selection.size ? selection : EMPTY,
  })
  remember()
}

/** Tell Gmail; if it refuses, show why and reload the truth. */
function settle(requests: Promise<unknown>[]) {
  Promise.all(requests).then(countsSoon, (error) => {
    fail(error)
    void load({ quiet: true })
  })
}

type Snapshot = Pick<MailboxState, 'threads' | 'bundles' | 'unread'> & { key: string }
const snapshot = (): Snapshot => ({
  key: viewKey(state.view),
  threads: state.threads,
  bundles: state.bundles,
  unread: state.unread,
})

/** A note with an Undo button that puts the screen back and reverses the request. */
function undoable(text: string, before: Snapshot, originals: Thread[], inverse: () => Promise<unknown>[]) {
  toast(text, {
    action: {
      label: 'ביטול',
      run: () => {
        originals.forEach((thread) => api.patchCachedThread(thread))
        const { key, ...screen } = before
        // Put the list back as it was, unless another folder is on screen by now.
        if (key === viewKey(state.view)) set(screen)
        else set({ unread: before.unread })
        remember()
        showUnreadCount()
        Promise.all(inverse()).then(
          () => void load({ quiet: true }),
          (error) => fail(error),
        )
      },
    },
  })
}

/** When the open conversation is filed or deleted: move to the next one on wide screens, back to the list on phones. */
function successor(ids: string[]): Thread | null | undefined {
  if (!state.open || !ids.includes(state.open.id)) return undefined
  if (!wideScreen()) return null
  const list = state.threads ?? []
  const index = list.findIndex((thread) => thread.id === state.open!.id)
  const free = (thread: Thread) => !ids.includes(thread.id)
  return list.slice(index + 1).find(free) ?? list.slice(0, Math.max(index, 0)).findLast(free) ?? null
}

function moveOn(next: Thread | null | undefined) {
  if (next === undefined) return
  if (next) openThread(next)
  else set({ open: null })
}

const many = (ids: string[], one: string, several: (count: number) => string) => (ids.length === 1 ? one : several(ids.length))
const unreadInInbox = (threads: Thread[]) => threads.filter((thread) => thread.unread && thread.labelIds.includes('INBOX')).length
const without = (labels: string[], ...remove: string[]) => labels.filter((label) => !remove.includes(label))
const withLabel = (labels: string[], label: string) => (labels.includes(label) ? labels : [...labels, label])

// ---------- Held mail and registered mail ----------

/** The reminder Doar's server keeps for a conversation: a hold, or a wait for an answer. */
const reminderFor = (threadId: string, kind: postman.Reminder['kind'], status: 'waiting' | 'returned' = 'waiting') =>
  state.reminders.find((reminder) => reminder.threadId === threadId && reminder.kind === kind && (reminder.status === 'returned') === (status === 'returned'))

const withoutReminders = (gone: postman.Reminder[]) => state.reminders.filter((reminder) => !gone.some((other) => other.id === reminder.id))

function reminderProblem(error: unknown): string {
  if (error instanceof api.GmailError) return error.message
  const code = error instanceof postman.PostmanError ? error.code : ''
  if (code === 'bad_time') return 'המועד שנבחר כבר עבר או רחוק מדי. בחרו מועד אחר.'
  if (code === 'too_late') return 'מאוחר מדי: המכתב כבר חזר.'
  if (code === 'too_many') return 'יש כבר יותר מדי מכתבים שמורים.'
  return 'אין קשר עם השרת של דואר כרגע. נסו שוב.'
}

/** A letter that came back has been dealt with: its "came back" note is no longer needed. */
function settleReturned(ids: string[]) {
  const done = state.reminders.filter((reminder) => reminder.status === 'returned' && ids.includes(reminder.threadId))
  if (done.length === 0) return
  set({ reminders: withoutReminders(done) })
  for (const reminder of done) postman.reminderCancel(reminder.id).catch(() => {})
}

/**
 * Held mail: the letters leave the inbox now, and Doar's server brings them back
 * at `when`, to the top and unread, with a notification.
 */
function hold(ids: string[], when: Date) {
  const originals = lookup(ids)
  if (originals.length === 0) return
  const before = snapshot()
  const next = successor(ids)
  settleReturned(ids)
  set({ unread: Math.max(0, state.unread - unreadInInbox(originals)) })
  change(ids, (thread) => ({ ...thread, labelIds: without(thread.labelIds, 'INBOX') }))
  if (isInboxLike(state.view)) drop(ids)
  else set({ selection: EMPTY })
  moveOn(next)
  showUnreadCount()
  playSound('thump')

  const made: postman.Reminder[] = []
  const work = Promise.all(
    ids.map(async (id) => {
      await api.modifyThread(id, [], ['INBOX'])
      made.push(await postman.holdCreate(id, when))
    }),
  ).then(
    () => {
      set({ reminders: [...state.reminders.filter((reminder) => !(reminder.kind === 'hold' && reminder.status === 'waiting' && ids.includes(reminder.threadId))), ...made] })
      countsSoon()
      return true
    },
    (error) => {
      toast(reminderProblem(error), { tone: 'error' })
      void refreshServer().then(() => load({ quiet: true }))
      return false
    },
  )
  undoable(many(ids, `המכתב יחזור ${formatWhen(when)}`, (n) => `${n} מכתבים יחזרו ${formatWhen(when)}`), before, originals, () => [
    work.then(() => {
      set({ reminders: withoutReminders(made) })
      return Promise.all([...ids.map((id) => api.modifyThread(id, ['INBOX'], [])), ...made.map((reminder) => postman.reminderCancel(reminder.id))])
    }),
  ])
}

/** Move a held letter to another time. */
async function rehold(threadId: string, when: Date) {
  const waiting = reminderFor(threadId, 'hold')
  if (!waiting) return
  try {
    const moved = await postman.reminderUpdate(waiting.id, when)
    set({ reminders: state.reminders.map((reminder) => (reminder.id === moved.id ? moved : reminder)) })
    toast(`המכתב יחזור ${formatWhen(when)}`)
  } catch (error) {
    toast(reminderProblem(error), { tone: 'error' })
    void refreshServer()
  }
}

/** Bring a held letter back to the inbox right now. */
async function bringBack(threadId: string) {
  const waiting = reminderFor(threadId, 'hold')
  if (waiting) set({ reminders: withoutReminders([waiting]) })
  const next = isFolder(state.view, 'held') ? successor([threadId]) : undefined
  change([threadId], (thread) => ({ ...thread, labelIds: withLabel(thread.labelIds, 'INBOX') }))
  if (isFolder(state.view, 'held')) drop([threadId])
  moveOn(next)
  try {
    await Promise.all([api.modifyThread(threadId, ['INBOX'], []), waiting ? postman.reminderCancel(waiting.id) : undefined])
    toast('המכתב חזר לדואר הנכנס')
    countsSoon()
  } catch (error) {
    toast(reminderProblem(error), { tone: 'error' })
    void refreshServer().then(() => load({ quiet: true }))
  }
}

/**
 * Registered mail: Doar's server watches a sent letter, and if nobody has answered
 * it within `days`, brings the conversation back to the inbox and says so.
 */
async function register(threadId: string, afterMessageId: string, days: number, announce = true): Promise<boolean> {
  try {
    const reminder = await postman.replyCreate(threadId, afterMessageId, days)
    set({ reminders: [...state.reminders.filter((other) => !(other.kind === 'reply' && other.threadId === threadId)), reminder] })
    if (announce) toast(`המכתב נרשם. אם לא יענו עד ${formatDay(reminder.dueAt)}, הוא יחזור אליך.`)
    return true
  } catch (error) {
    toast(`לא הצלחנו לרשום את המכתב. ${reminderProblem(error)}`, { tone: 'error' })
    return false
  }
}

/** Stop waiting for an answer to a registered letter (also clears its "no answer" note). */
async function unregister(threadId: string) {
  const rows = state.reminders.filter((reminder) => reminder.kind === 'reply' && reminder.threadId === threadId)
  if (rows.length === 0) return
  set({ reminders: withoutReminders(rows) })
  const next = isFolder(state.view, 'waiting') ? successor([threadId]) : undefined
  if (isFolder(state.view, 'waiting')) drop([threadId])
  moveOn(next)
  try {
    await Promise.all(rows.map((reminder) => postman.reminderCancel(reminder.id)))
    toast('הרישום בוטל. לא תגיע תזכורת.')
  } catch (error) {
    toast(reminderProblem(error), { tone: 'error' })
    void refreshServer()
  }
}

// ---------- Marked senders and opening hours ----------

/**
 * Mark a sender (an address, or a whole site): "express" always notifies at once;
 * "refused" sends their future mail straight to the bin. `on: false` takes the mark off.
 */
async function setMark(sender: string, mark: postman.SenderMark['mark'], on: boolean): Promise<boolean> {
  try {
    const saved = await postman.markSet(sender, mark, on)
    if (saved) set({ marks: [...state.marks.filter((other) => other.id !== saved.id), saved] })
    else void refreshServer()
    return true
  } catch (error) {
    const code = error instanceof postman.PostmanError ? error.code : ''
    toast(code === 'bad_match' ? 'לא הבנו את הכתובת הזאת.' : code === 'too_many' ? 'יש כבר יותר מדי שולחים מסומנים.' : 'אין קשר עם השרת של דואר כרגע. נסו שוב.', { tone: 'error' })
    return false
  }
}

async function removeMark(id: string) {
  const mark = state.marks.find((other) => other.id === id)
  if (!mark) return
  set({ marks: state.marks.filter((other) => other.id !== id) })
  try {
    await postman.markSet(mark.match, mark.mark, false)
  } catch {
    set({ marks: [...state.marks, mark] })
    toast('אין קשר עם השרת של דואר כרגע. נסו שוב.', { tone: 'error' })
  }
}

// ---------- Return to sender, corrections, and senders you know ----------

/** Ask a mailing list to stop writing, by the email its own letters name for that. */
async function mailUnsubscribe(mailto: string) {
  const [address = '', query = ''] = mailto.split('?')
  const params = new URLSearchParams(query)
  await api.sendRaw(
    buildMime({
      from: state.me,
      to: [{ name: '', email: decodeURIComponent(address) }],
      cc: [],
      bcc: [],
      subject: params.get('subject') ?? 'unsubscribe',
      html: '<div>unsubscribe</div>',
      text: params.get('body') ?? 'unsubscribe',
      attachments: [],
    }),
  )
}

/**
 * Return to sender: this letter goes to the bin, the sender's future mail goes straight
 * there too, and a mailing list is asked, the proper way, to stop writing. Nothing
 * happens for five seconds, while "undo" is open; leaving a list cannot be taken back.
 */
function returnToSender(thread: Thread, message: Message) {
  const sender = message.from
  const address = sender.email.toLowerCase()
  if (!address || state.returning.has(thread.id)) return
  const done = () => set({ returning: new Set([...state.returning].filter((id) => id !== thread.id)) })
  set({ returning: new Set([...state.returning, thread.id]) })
  playSound('thump')
  tapHaptic()

  const carryOut = async () => {
    if (!(await setMark(address, 'refused', true))) return done()
    let page: string | null = null
    if (message.unsubscribe) {
      try {
        // The server sends the list's own "one click" request; where a list has none, its email or its page.
        const answer = await postman.unsubscribe(message.id)
        if (answer.done !== 'posted') {
          if (answer.mailto) await mailUnsubscribe(answer.mailto)
          else page = answer.url
        }
      } catch {
        // The sender is refused either way; only the request to the list did not go out.
        page = message.unsubscribe.url ?? null
      }
    }
    trash([thread.id], { quiet: true })
    done()
    if (page) {
      const url = page
      toast('השולח נחסם. כדי לרדת גם מרשימת התפוצה שלו, יש לו דף הסרה.', { duration: 9000, action: { label: 'לדף ההסרה', run: () => window.open(url, '_blank', 'noopener') } })
    }
  }

  let undone = false
  toast(`הוחזר לשולח. מכתבים מ־${shortName(sender)} יגיעו מעכשיו ישר לאשפה.`, {
    duration: 5000,
    countdown: true,
    action: {
      label: 'ביטול',
      run: () => {
        undone = true
        done()
      },
    },
    onExpire: () => {
      if (!undone) void carryOut()
    },
  })
}

/** "This is not a parcel": remembered for the sender, on every device. */
function notKind(kind: Exclude<Kind, 'letter'>, sender: Contact) {
  const address = sender.email.toLowerCase()
  const before = getSettings().notKinds
  const already = before[address] ?? []
  if (!address || already.includes(kind)) return
  updateSettings({ notKinds: { ...before, [address]: [...already, kind] } })
  toast(`מכתבים מ־${shortName(sender)} לא יוצגו עוד כ${KIND_NAMES[kind]}.`, { action: { label: 'ביטול', run: () => updateSettings({ notKinds: before }) } })
}

/** "The sender is known to me": the inspector's soft notes about them are put away. */
function trustSender(sender: Contact) {
  const address = sender.email.toLowerCase()
  const before = getSettings().trusted
  if (!address || before.includes(address)) return
  updateSettings({ trusted: [...before, address] })
  toast(`הכתובת של ${shortName(sender)} נרשמה כמוכרת.`, { action: { label: 'ביטול', run: () => updateSettings({ trusted: before }) } })
}

/** Your own note on a conversation ("" takes it off). Kept by Doar's server, so every device shows it. */
async function setNote(threadId: string, text: string) {
  const before = state.notes
  const notes = { ...before }
  if (text) notes[threadId] = text
  else delete notes[threadId]
  set({ notes })
  try {
    await postman.noteSet(threadId, text)
  } catch {
    set({ notes: before })
    toast('הפתק לא נשמר. בדקו את החיבור ונסו שוב.', { tone: 'error' })
  }
}

/** Opening hours for notifications (null: they may arrive at any time). */
async function setHours(hours: postman.Hours | null) {
  const before = state.hours
  set({ hours })
  try {
    await postman.hoursSet(hours)
  } catch {
    set({ hours: before })
    toast('השעות לא נשמרו. בדקו את החיבור ונסו שוב.', { tone: 'error' })
  }
}

/** File: out of the inbox, still in "all mail". */
function archive(ids: string[]) {
  const originals = lookup(ids)
  if (originals.length === 0) return
  settleReturned(ids)
  const before = snapshot()
  const next = successor(ids)
  set({ unread: Math.max(0, state.unread - unreadInInbox(originals)) })
  change(ids, (thread) => ({ ...thread, labelIds: without(thread.labelIds, 'INBOX') }))
  if (isInboxLike(state.view)) drop(ids)
  else set({ selection: EMPTY })
  moveOn(next)
  showUnreadCount()
  playSound('thump')
  settle(ids.map((id) => api.modifyThread(id, [], ['INBOX'])))
  undoable(many(ids, 'המכתב תויק', (n) => `${n} מכתבים תויקו`), before, originals, () =>
    ids.map((id) => api.modifyThread(id, ['INBOX'], [])),
  )
}

function trash(ids: string[], options: { quiet?: boolean } = {}) {
  const originals = lookup(ids)
  if (originals.length === 0) return
  settleReturned(ids)
  const before = snapshot()
  const next = successor(ids)
  set({ unread: Math.max(0, state.unread - unreadInInbox(originals)) })
  change(ids, (thread) => ({ ...thread, labelIds: withLabel(without(thread.labelIds, 'INBOX'), 'TRASH') }))
  drop(ids)
  moveOn(next)
  showUnreadCount()
  playSound('paper')
  settle(ids.map((id) => api.trashThread(id)))
  if (options.quiet) return
  // Gmail takes a deleted letter out of the inbox and doesn't put it back by itself.
  const wasInInbox = new Set(originals.filter((thread) => thread.labelIds.includes('INBOX')).map((thread) => thread.id))
  undoable(many(ids, 'המכתב הועבר לאשפה', (n) => `${n} מכתבים הועברו לאשפה`), before, originals, () =>
    ids.map((id) => api.untrashThread(id).then(() => (wasInInbox.has(id) ? api.modifyThread(id, ['INBOX'], []) : undefined))),
  )
}

/** Take mail out of the trash and back into the inbox. */
function untrash(ids: string[]) {
  const next = successor(ids)
  change(ids, (thread) => ({ ...thread, labelIds: withLabel(without(thread.labelIds, 'TRASH'), 'INBOX') }))
  if (isFolder(state.view, 'trash')) drop(ids)
  moveOn(next)
  settle(ids.map((id) => api.untrashThread(id).then(() => api.modifyThread(id, ['INBOX'], []))))
  toast(many(ids, 'המכתב שוחזר לדואר הנכנס', (n) => `${n} מכתבים שוחזרו לדואר הנכנס`))
}

function spam(ids: string[]) {
  const originals = lookup(ids)
  if (originals.length === 0) return
  const before = snapshot()
  const next = successor(ids)
  set({ unread: Math.max(0, state.unread - unreadInInbox(originals)) })
  change(ids, (thread) => ({ ...thread, labelIds: withLabel(without(thread.labelIds, 'INBOX'), 'SPAM') }))
  drop(ids)
  moveOn(next)
  showUnreadCount()
  settle(ids.map((id) => api.modifyThread(id, ['SPAM'], ['INBOX'])))
  undoable(many(ids, 'סומן כספאם', (n) => `${n} מכתבים סומנו כספאם`), before, originals, () =>
    ids.map((id) => api.modifyThread(id, ['INBOX'], ['SPAM'])),
  )
}

function notSpam(ids: string[]) {
  const next = successor(ids)
  change(ids, (thread) => ({ ...thread, labelIds: withLabel(without(thread.labelIds, 'SPAM'), 'INBOX') }))
  if (isFolder(state.view, 'spam')) drop(ids)
  moveOn(next)
  settle(ids.map((id) => api.modifyThread(id, ['INBOX'], ['SPAM'])))
  toast(many(ids, 'המכתב הוחזר לדואר הנכנס', (n) => `${n} מכתבים הוחזרו לדואר הנכנס`))
}

function moveToInbox(ids: string[]) {
  const next = isFolder(state.view, 'archive') ? successor(ids) : undefined
  change(ids, (thread) => ({ ...thread, labelIds: withLabel(thread.labelIds, 'INBOX') }))
  if (isFolder(state.view, 'archive')) drop(ids)
  else set({ selection: EMPTY })
  moveOn(next)
  settle(ids.map((id) => api.modifyThread(id, ['INBOX'], [])))
  toast(many(ids, 'המכתב הוחזר לדואר הנכנס', (n) => `${n} מכתבים הוחזרו לדואר הנכנס`))
}

function setRead(ids: string[], read: boolean, options: { announce?: boolean } = {}) {
  const targets = lookup(ids).filter((thread) => thread.unread === read)
  if (targets.length === 0) return
  const changed = targets.map((thread) => thread.id)
  const shift = targets.filter((thread) => thread.labelIds.includes('INBOX')).length * (read ? -1 : 1)
  set({ unread: Math.max(0, state.unread + shift) })
  change(changed, (thread) => ({
    ...thread,
    unread: !read,
    labelIds: read ? without(thread.labelIds, 'UNREAD') : withLabel(thread.labelIds, 'UNREAD'),
  }))
  showUnreadCount()
  settle(changed.map((id) => (read ? api.modifyThread(id, [], ['UNREAD']) : api.modifyThread(id, ['UNREAD'], []))))
  if (options.announce) {
    toast(read ? many(changed, 'סומן כנקרא', (n) => `${n} מכתבים סומנו כנקראו`) : many(changed, 'סומן כלא נקרא', (n) => `${n} מכתבים סומנו כלא נקראו`))
  }
}

function toggleStar(id: string) {
  const [thread] = lookup([id])
  if (!thread) return
  const starred = !thread.starred
  change([id], (t) => ({ ...t, starred, labelIds: starred ? withLabel(t.labelIds, 'STARRED') : without(t.labelIds, 'STARRED') }))
  if (starred) {
    tapHaptic()
    playSound('tick')
  }
  settle([starred ? api.modifyThread(id, ['STARRED'], []) : api.modifyThread(id, [], ['STARRED'])])
}

/** Put one of your labels on these conversations, or take it off. */
function setLabel(ids: string[], labelId: string, on: boolean) {
  change(ids, (thread) => ({ ...thread, labelIds: on ? withLabel(thread.labelIds, labelId) : without(thread.labelIds, labelId) }))
  settle(ids.map((id) => (on ? api.modifyThread(id, [labelId], []) : api.modifyThread(id, [], [labelId]))))
}

function labelProblem(error: unknown): string {
  if (error instanceof api.GmailError && error.status === 409) return 'כבר יש תווית בשם הזה.'
  return errorText(error)
}

async function addLabel(name: string): Promise<Label | null> {
  try {
    const label = await api.createLabel(name.trim())
    set({ labels: [...state.labels, label].sort((a, b) => a.name.localeCompare(b.name, 'he')) })
    remember()
    return label
  } catch (error) {
    toast(labelProblem(error), { tone: 'error' })
    return null
  }
}

/** Rename a label, or change its tape color (null: no color of its own). */
async function changeLabel(id: string, change: { name?: string; color?: string | null }): Promise<boolean> {
  try {
    const label = await api.updateLabel(id, change)
    set({
      labels: state.labels.map((other) => (other.id === id ? label : other)).sort((a, b) => a.name.localeCompare(b.name, 'he')),
      view: state.view.kind === 'label' && state.view.id === id ? { ...state.view, name: label.name } : state.view,
    })
    remember()
    return true
  } catch (error) {
    toast(labelProblem(error), { tone: 'error' })
    return false
  }
}

/** Delete a label. The letters that wore it stay where they are; its automatic rules go with it. */
async function removeLabel(id: string): Promise<boolean> {
  try {
    await api.deleteLabel(id)
  } catch (error) {
    toast(labelProblem(error), { tone: 'error' })
    return false
  }
  for (const rule of state.rules.filter((item) => item.labelId === id)) postman.ruleDelete(rule.id).catch(() => {})
  const strip = (thread: Thread) => (thread.labelIds.includes(id) ? { ...thread, labelIds: without(thread.labelIds, id) } : thread)
  const wasOpen = state.view.kind === 'label' && state.view.id === id
  viewCache.clear()
  set({
    labels: state.labels.filter((label) => label.id !== id),
    rules: state.rules.filter((rule) => rule.labelId !== id),
    threads: state.threads?.map(strip) ?? null,
    bundles: state.bundles.map((bundle) => ({ ...bundle, threads: bundle.threads.map(strip) })),
    open: state.open ? strip(state.open) : null,
  })
  remember()
  if (wasOpen) show(INBOX)
  toast('התווית נמחקה. המכתבים שנשאו אותה נשארו במקומם.')
  return true
}

// ---------- Reading ----------

function openThread(thread: Thread) {
  // A conversation that is only an unsent draft opens straight in the writing form.
  if (thread.messageCount === 0 && thread.hasDraft) {
    api.loadMessages(thread).then(
      (messages) => {
        const draft = messages.findLast((message) => message.isDraft)
        if (draft) void editDraft(draft)
      },
      (error) => toast(errorText(error), { tone: 'error' }),
    )
    return
  }
  set({ open: thread })
  if (thread.unread) setRead([thread.id], true)
}

/** Open a conversation by its id (from a notification), fetching it if no list has it. */
async function openById(id: string) {
  const [known] = lookup([id])
  if (known) {
    openThread(known)
    return
  }
  try {
    openThread(await api.getThread(id))
  } catch (error) {
    toast(errorText(error), { tone: 'error' })
  }
}

function toggleSelect(id: string) {
  const selection = new Set(state.selection)
  if (selection.has(id)) selection.delete(id)
  else selection.add(id)
  tapHaptic()
  playSound('tick')
  set({ selection: selection.size ? selection : EMPTY })
}

// ---------- Writing ----------

function compose(draft: ComposeDraft) {
  set({ compose: draft, composeKey: state.composeKey + 1 })
}

/** Close the writing form. Pass the conversation it belonged to, so its draft shows there. */
function closeCompose(threadId?: string) {
  set({ compose: null })
  afterDraftChange(threadId)
}

function afterDraftChange(threadId?: string) {
  if (threadId) {
    api.forgetMessages(threadId)
    if (state.open?.id === threadId) set({ openRevision: state.openRevision + 1 })
  }
  countsSoon()
  if (isFolder(state.view, 'drafts')) void load({ quiet: true })
}

async function editDraft(message: Message) {
  try {
    const draftId = (await api.listDraftIds()).get(message.id)
    if (!draftId) {
      toast('הטיוטה הזאת כבר לא קיימת.', { tone: 'error' })
      afterDraftChange(message.threadId)
      return
    }
    compose(draftFromMessage(message, draftId))
  } catch (error) {
    toast(errorText(error), { tone: 'error' })
  }
}

async function discardDraft(draftId: string | undefined, threadId?: string) {
  set({ compose: null })
  if (!draftId) return
  dropSchedule(draftId)
  try {
    await api.deleteDraft(draftId)
    toast('הטיוטה נמחקה')
  } catch (error) {
    toast(errorText(error), { tone: 'error' })
  }
  afterDraftChange(threadId)
}

/**
 * Send a saved draft. The letter leaves the screen at once; the actual send
 * waits a few seconds so it can still be taken back.
 */
function send(draft: ComposeDraft & { draftId: string }, followupDays: number | null = null) {
  const seconds = getSettings().undoSendSeconds
  const recipient = draft.to[0] ?? draft.cc[0] ?? draft.bcc[0]
  set({ compose: null, flight: { to: recipient ? shortName(recipient) : '' } })

  let settled = false
  let noteId = 0
  const stopWatching = () => document.removeEventListener('visibilitychange', onHide)

  const deliver = () => {
    if (settled) return
    settled = true
    stopWatching()
    dropSchedule(draft.draftId)
    api.sendDraft(draft.draftId).then(
      (sent) => {
        if (seconds > 0) toast(followupDays ? 'המכתב נשלח, ונרשם' : 'המכתב נשלח')
        // Registered: from now the server waits for an answer to this very letter.
        if (followupDays && sent?.id) void register(sent.threadId, sent.id, followupDays, false)
        afterDraftChange(draft.threadId)
        void load({ quiet: true })
      },
      (error) => {
        toast(`השליחה נכשלה, והמכתב נשמר בטיוטות. ${errorText(error)}`, {
          tone: 'error',
          duration: 10_000,
          action: { label: 'פתיחה', run: () => compose(draft) },
        })
      },
    )
  }

  // Leaving the app during the countdown sends right away, in a way that survives the page closing.
  function onHide() {
    if (document.visibilityState !== 'hidden' || settled) return
    const token = peekGoogleAccessToken()
    if (!token) return
    settled = true
    stopWatching()
    dropSchedule(draft.draftId)
    api.sendDraftOnExit(draft.draftId, token)
    dismissToast(noteId)
    afterDraftChange(draft.threadId)
  }

  if (seconds === 0) {
    deliver()
    toast(followupDays ? 'המכתב נשלח, ונרשם' : 'המכתב נשלח')
    return
  }
  document.addEventListener('visibilitychange', onHide)
  noteId = toast('המכתב בדרך', {
    countdown: true,
    duration: seconds * 1000,
    onExpire: deliver,
    action: {
      label: 'ביטול שליחה',
      run: () => {
        settled = true
        stopWatching()
        compose(draft)
      },
    },
  })
}

// ---------- Sending later ----------

/** What Gmail says each waiting draft holds, so the list can show who it's for. */
const draftInfos = new Map<string, { to: Contact[]; subject: string; message: Message }>()

const byTime = (items: Scheduled[]) => [...items].sort((a, b) => (a.sendAt < b.sendAt ? -1 : a.sendAt > b.sendAt ? 1 : 0))

const describe = (item: postman.ScheduledSend): Scheduled => {
  const info = draftInfos.get(item.draftId)
  return info ? { ...item, to: info.to, subject: info.subject } : item
}

let sendTimer: ReturnType<typeof setTimeout> | undefined

/** Look again right after the next waiting letter is due, so the lists show that it left. */
function watchSends() {
  clearTimeout(sendTimer)
  const next = state.scheduled.find((item) => item.status === 'pending')
  if (!next) return
  const late = Date.now() - Date.parse(next.sendAt)
  // Due soon: just after its time. Already due: every few seconds at first, then every minute.
  const wait = late < 0 ? 6_000 - late : late < 180_000 ? 10_000 : 60_000
  if (wait > 2_000_000_000) return
  sendTimer = setTimeout(() => {
    void refreshServer().then(() => {
      if (!state.scheduled.some((item) => item.id === next.id && item.status === 'pending')) void load({ quiet: true })
    })
  }, wait)
}

/** Ask Doar's server what it holds for us: letters waiting to be sent, and this account's notification devices. */
async function refreshServer() {
  try {
    const status = await postman.serverStatus()
    set({
      scheduled: byTime(status.scheduled.map(describe)),
      rules: status.rules,
      reminders: status.reminders,
      marks: status.marks,
      notes: Object.fromEntries(status.notes.map((note) => [note.threadId, note.text])),
      hours: status.hours,
      server: { reachable: true, askedAt: Date.now(), lookedAt: status.lookedAt, devices: status.devices, lastReport: status.lastReport },
    })
    watchSends()
    void syncPush(status)
    // Settings changed on another device arrive here; a change to bundles redraws every list.
    if (applyShared(status.prefs).includes('bundles')) {
      viewCache.clear()
      void load({ quiet: true })
    }
    // Fill in recipients and subjects from Gmail, for the letters we haven't seen yet.
    for (const item of status.scheduled) {
      if (draftInfos.has(item.draftId)) continue
      api.draftInfo(item.draftId).then(
        (info) => {
          draftInfos.set(item.draftId, info)
          set({ scheduled: state.scheduled.map((other) => (other.draftId === item.draftId ? describe(other) : other)) })
        },
        () => {},
      )
    }
  } catch {
    // The server can't be reached right now; mail itself still works.
    if (state.server) set({ server: { ...state.server, reachable: false } })
  }
}

function scheduleProblem(error: unknown): string {
  const code = error instanceof postman.PostmanError ? error.code : ''
  if (code === 'bad_time') return 'המועד שנבחר כבר עבר או רחוק מדי. בחרו מועד אחר.'
  if (code === 'too_late') return 'מאוחר מדי: המכתב כבר נשלח.'
  if (code === 'draft_missing') return 'הטיוטה הזאת כבר לא קיימת.'
  if (code === 'reauth') return 'צריך להתחבר מחדש כדי לתזמן מכתבים.'
  return 'אין קשר עם השרת של דואר כרגע. המכתב שמור בטיוטות.'
}

/** Forget a draft's schedule because the draft is being sent now or thrown away. */
function dropSchedule(draftId: string) {
  const waiting = state.scheduled.find((item) => item.draftId === draftId)
  if (!waiting) return
  set({ scheduled: state.scheduled.filter((item) => item !== waiting) })
  postman.scheduleCancel(waiting.id).catch(() => {})
}

/** Leave a saved draft with the server, to be sent at `when` even if every device is off. */
async function schedule(draft: ComposeDraft & { draftId: string }, when: Date, followupDays: number | null = null) {
  set({ compose: null })
  try {
    const row = await postman.scheduleCreate(draft.draftId, when, followupDays)
    const to = [...draft.to, ...draft.cc, ...draft.bcc]
    set({
      scheduled: byTime([...state.scheduled.filter((item) => item.draftId !== draft.draftId), { ...row, to, subject: draft.subject }]),
    })
    watchSends()
    playSound('thump')
    toast(`המכתב יישלח ${formatWhen(when)}`, { action: { label: 'ביטול', run: () => void unschedule(row.id) } })
    afterDraftChange(draft.threadId)
  } catch (error) {
    toast(scheduleProblem(error), {
      tone: 'error',
      duration: 10_000,
      action: { label: 'פתיחה', run: () => compose(draft) },
    })
  }
}

/** Move a waiting letter to another time (a letter that failed gets a fresh start). */
async function reschedule(id: string, when: Date) {
  const item = state.scheduled.find((other) => other.id === id)
  if (!item) return
  try {
    const row = item.status === 'failed' ? await postman.scheduleCreate(item.draftId, when) : await postman.scheduleUpdate(id, when)
    if (item.status === 'failed') postman.scheduleCancel(id).catch(() => {})
    set({ scheduled: byTime(state.scheduled.map((other) => (other.id === id ? { ...other, ...row } : other))) })
    watchSends()
    toast(`המכתב יישלח ${formatWhen(when)}`)
  } catch (error) {
    toast(scheduleProblem(error), { tone: 'error' })
    void refreshServer()
  }
}

/** Take a letter off the schedule; it stays in Drafts. Resolves to false if it already left. */
async function unschedule(id: string): Promise<boolean> {
  const item = state.scheduled.find((other) => other.id === id)
  if (!item) return true
  try {
    await postman.scheduleCancel(id)
  } catch (error) {
    toast(scheduleProblem(error), { tone: 'error' })
    void refreshServer()
    return false
  }
  set({ scheduled: state.scheduled.filter((other) => other.id !== id) })
  toast(item.status === 'failed' ? 'המכתב הוסר מהרשימה. הוא שמור בטיוטות.' : 'התזמון בוטל. המכתב שמור בטיוטות.')
  afterDraftChange(item.threadId ?? undefined)
  return true
}

/** Open a waiting letter in the writing form (it stays scheduled unless you send it or cancel). */
async function openScheduled(id: string) {
  const item = state.scheduled.find((other) => other.id === id)
  if (!item) return
  try {
    const info = draftInfos.get(item.draftId) ?? (await api.draftInfo(item.draftId))
    draftInfos.set(item.draftId, info)
    compose(draftFromMessage(info.message, item.draftId))
  } catch {
    toast('הטיוטה הזאת כבר לא קיימת.', { tone: 'error' })
    void refreshServer()
  }
}

// ---------- Automatic labels ----------

function ruleProblem(error: unknown): string {
  if (error instanceof api.GmailError) return error.message
  const code = error instanceof postman.PostmanError ? error.code : ''
  if (code === 'bad_match') return 'לא הבנו ממי. כתבו כתובת מייל מלאה, או שם אתר כמו bank.co.il.'
  if (code === 'label_missing') return 'התווית הזאת כבר לא קיימת.'
  if (code === 'too_many') return 'יש כבר יותר מדי כללים. הסירו כלל שאינו נחוץ.'
  if (code === 'reauth') return 'צריך להתחבר מחדש כדי לשמור כללים.'
  return 'אין קשר עם השרת של דואר כרגע. נסו שוב.'
}

/**
 * From now on, mail from `from` (an address or a site) gets this label by itself:
 * Doar's server puts it on within a minute of the letter arriving. With `existing`,
 * the server also puts it, right now, on the mail from that sender that is already here.
 */
async function addRule(from: string, labelId: string, existing: boolean): Promise<boolean> {
  try {
    const { rule, labeled, threadIds } = await postman.ruleCreate(from, labelId, existing)
    set({ rules: [...state.rules.filter((other) => other.id !== rule.id), rule] })
    if (!existing || labeled === 0) {
      toast('הכלל נשמר. מכתבים חדשים יתויגו לבד.')
      return true
    }
    if (labeled === null) {
      toast('הכלל נשמר, אבל את המכתבים שכבר הגיעו לא הצלחנו לתייג. מכתבים חדשים יתויגו לבד.', { tone: 'error', duration: 9000 })
      return true
    }
    // The server already put the label on in Gmail; show it on the letters on screen.
    change(threadIds, (thread) => ({ ...thread, labelIds: withLabel(thread.labelIds, labelId) }))
    viewCache.delete(`label:${labelId}`)
    toast(labeled === 1 ? 'הכלל נשמר, ומכתב אחד שכבר הגיע תויג.' : `הכלל נשמר, ו־${labeled} מכתבים שכבר הגיעו תויגו.`)
    return true
  } catch (error) {
    toast(ruleProblem(error), { tone: 'error' })
    return false
  }
}

async function removeRule(id: string) {
  const before = state.rules
  set({ rules: before.filter((rule) => rule.id !== id) })
  try {
    await postman.ruleDelete(id)
    toast('הכלל הוסר. תוויות שכבר הודבקו נשארות.')
  } catch (error) {
    set({ rules: before })
    toast(ruleProblem(error), { tone: 'error' })
  }
}

// ---------- Opened from outside ----------

/** A tapped notification, a mail link, the icon's shortcut, or a share from another app. */
function handleLaunch(intent: LaunchIntent) {
  const write = (draft: ComposeDraft) => {
    if (state.compose) toast('יש מכתב פתוח. סגרו אותו כדי להתחיל חדש.')
    else compose(draft)
  }
  switch (intent.kind) {
    case 'thread':
      void openById(intent.id)
      break
    case 'compose':
      write(intent.draft)
      break
    case 'scheduled':
      show({ kind: 'folder', id: 'scheduled' })
      break
    case 'share':
      void takeShared().then((draft) => draft && write(draft))
      break
  }
}

// ---------- Running ----------

let stopRunning: (() => void) | null = null

/** Start checking for new mail; call when the mailbox appears on screen. */
function start() {
  stop()
  void load()
  void refreshLabels()
  void harvestRecipients()
  void refreshServer()
  clearNotifications()
  // New mail can settle a held or a registered letter, so the server is asked again too.
  const onMail = () => {
    void load({ quiet: true })
    if (state.reminders.length) void refreshServer()
  }
  const stopLaunch = onLaunch(handleLaunch, onMail)

  const poll = setInterval(() => {
    if (!navigator.onLine || document.hidden) return
    void load({ quiet: true })
    // A waiting letter may have left in the meantime, and a held one may have come back.
    if (state.scheduled.length || state.reminders.length) void refreshServer()
  }, POLL_MS)
  const onVisible = () => {
    if (document.hidden) return
    clearNotifications()
    if (Date.now() - lastLoadAt > 30_000) {
      void load({ quiet: true })
      void refreshServer()
    }
  }
  const onOnline = () => {
    set({ online: true })
    void load({ quiet: true })
  }
  const onOffline = () => set({ online: false })
  const onDemoMail = onMail
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  if (isDemo) window.addEventListener(DEMO_MAIL, onDemoMail)
  stopRunning = () => {
    window.removeEventListener(DEMO_MAIL, onDemoMail)
    stopLaunch()
    clearTimeout(sendTimer)
    clearInterval(poll)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}

function stop() {
  stopRunning?.()
  stopRunning = null
}

/** Forget the mail kept on this device, and stop everything that runs in it. */
function forgetLocal() {
  try {
    localStorage.removeItem(savedKey(state.me.email))
  } catch {
    // Nothing to remove.
  }
  stop()
  viewCache.clear()
  draftInfos.clear()
  // The letters kept on this device for opening at once and with no connection.
  if (!isDemo) api.forgetAllMessages()
  state = blank({ name: '', email: '' })
  document.title = 'דואר'
}

/**
 * Sign out on this device only. Your other devices stay signed in, and scheduled
 * letters, notifications to them and automatic labels carry on.
 */
function leave() {
  forgetLocal()
  if (isDemo) {
    // Leaving the demo: on to the real front door.
    window.location.assign('/')
    return
  }
  // The server must stop notifying this device before the session that proves who we are is gone.
  void forgetPush().finally(() => void signOut())
}

/**
 * Disconnect every device and erase what Doar's server keeps for this account.
 * The mail itself, in Gmail, is not touched.
 */
async function forgetEverything() {
  const waiting = state.scheduled.filter((item) => item.status === 'pending').length
  const warning = [
    'הפעולה הזאת מנתקת את דואר מכל המכשירים שלך, ומוחקת מהשרת של דואר את מפתח ההתחברות, כתובות ההתראות וכללי התיוג.',
    waiting ? `${waiting === 1 ? 'מכתב מתוזמן אחד לא יישלח; הוא נשאר' : `${waiting} מכתבים מתוזמנים לא יישלחו; הם נשארים`} בטיוטות.` : '',
    'הדואר עצמו, ב־Gmail, לא נמחק. להמשיך?',
  ]
  if (!window.confirm(warning.filter(Boolean).join('\n\n'))) return
  if (isDemo) {
    leave()
    return
  }
  try {
    await forgetPush()
    await eraseAccount()
  } catch {
    toast('המחיקה מהשרת לא הצליחה. בדקו את החיבור ונסו שוב.', { tone: 'error' })
    return
  }
  forgetLocal()
}

export const mailbox = {
  /** The current state, for code that runs outside rendering (keyboard shortcuts). */
  state: () => state,
  start,
  stop,
  show,
  reload: () => load(),
  /** Bundles were switched on or off: every list is different now. */
  settingsChanged: () => {
    viewCache.clear()
    void load()
  },
  loadMore,
  open: openThread,
  close: () => set({ open: null }),
  archive,
  trash,
  untrash,
  spam,
  notSpam,
  moveToInbox,
  setRead,
  toggleStar,
  setLabel,
  addLabel,
  changeLabel,
  removeLabel,
  toggleSelect,
  /** Select every letter in the list on screen. */
  selectAll: () => set({ selection: new Set((state.threads ?? []).map((thread) => thread.id)) }),
  clearSelection: () => set({ selection: EMPTY }),
  clearArrived: () => state.arrived.size && set({ arrived: EMPTY }),
  compose,
  closeCompose,
  reply: (message: Message, mode: 'reply' | 'replyAll' | 'forward') => compose(replyDraft(message, mode, state.me)),
  editDraft,
  discardDraft,
  send,
  schedule,
  reschedule,
  unschedule,
  openScheduled,
  hold,
  rehold,
  bringBack,
  register,
  unregister,
  setMark,
  removeMark,
  setHours,
  returnToSender,
  setNote,
  notKind,
  trustSender,
  addRule,
  removeRule,
  forgetEverything,
  endFlight: () => set({ flight: null }),
  signOut: leave,
}
