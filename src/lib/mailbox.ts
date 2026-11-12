import { useSyncExternalStore } from 'react'
import type { ComposeDraft, Contact, Label, Message, Thread } from '../types'
import { shortName } from './addresses'
import { signOut } from './auth'
import { draftFromMessage, replyDraft } from './compose'
import { harvestRecipients, rememberContacts } from './contacts'
import { countLetters } from './format'
import * as api from './gmail'
import { peekGoogleAccessToken, ReauthRequiredError } from './googleToken'
import { tapHaptic } from './platform'
import { getSettings } from './settings'
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
  online: boolean
}

const EMPTY: ReadonlySet<string> = new Set()
const POLL_MS = 90_000
const SAVED_VERSION = 2

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
  try {
    const [page, counts, bundles] = await Promise.all([
      api.listThreads(viewQuery(view, bundlesOn)),
      loadCounts(),
      inbox ? (bundlesOn ? loadBundles() : Promise.resolve([])) : Promise.resolve(null),
    ])
    if (seq !== loadSeq) return
    lastLoadAt = Date.now()

    const fresh = page.threads.filter((thread) => belongsInView(view, thread, bundlesOn))
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
    if (arrived.length || moreUnread) announce(arrived)
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

function announce(arrived: Thread[]) {
  playSound('paper')
  if (!document.hidden || !getSettings().notifications) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const unread = arrived.filter((thread) => thread.unread)
  const one = unread.length === 1 ? unread[0]! : null
  const title = one ? shortName(one.from) : 'דואר חדש'
  const body = one
    ? one.subject
    : unread.length
      ? unread.slice(0, 3).map((thread) => shortName(thread.from)).join(', ')
      : `${countLetters(state.unread)} שלא נקראו`
  const options: NotificationOptions = { body, icon: '/pwa-192x192.png', badge: '/pwa-64x64.png', tag: 'doar-new-mail', dir: 'rtl', lang: 'he' }
  // Phones only allow notifications through the service worker; PCs accept either.
  const worker = navigator.serviceWorker?.getRegistration() ?? Promise.resolve(undefined)
  worker
    .then((registration) => (registration ? registration.showNotification(title, options) : void new Notification(title, options)))
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

/** File: out of the inbox, still in "all mail". */
function archive(ids: string[]) {
  const originals = lookup(ids)
  if (originals.length === 0) return
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

function trash(ids: string[]) {
  const originals = lookup(ids)
  if (originals.length === 0) return
  const before = snapshot()
  const next = successor(ids)
  set({ unread: Math.max(0, state.unread - unreadInInbox(originals)) })
  change(ids, (thread) => ({ ...thread, labelIds: withLabel(without(thread.labelIds, 'INBOX'), 'TRASH') }))
  drop(ids)
  moveOn(next)
  showUnreadCount()
  playSound('paper')
  settle(ids.map((id) => api.trashThread(id)))
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
  change(ids, (thread) => ({ ...thread, labelIds: withLabel(thread.labelIds, 'INBOX') }))
  set({ selection: EMPTY })
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

async function addLabel(name: string): Promise<Label | null> {
  try {
    const label = await api.createLabel(name.trim())
    set({ labels: [...state.labels, label].sort((a, b) => a.name.localeCompare(b.name, 'he')) })
    remember()
    return label
  } catch (error) {
    toast(errorText(error), { tone: 'error' })
    return null
  }
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
function send(draft: ComposeDraft & { draftId: string }) {
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
    api.sendDraft(draft.draftId).then(
      () => {
        if (seconds > 0) toast('המכתב נשלח')
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
    api.sendDraftOnExit(draft.draftId, token)
    dismissToast(noteId)
    afterDraftChange(draft.threadId)
  }

  if (seconds === 0) {
    deliver()
    toast('המכתב נשלח')
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

// ---------- Running ----------

let stopRunning: (() => void) | null = null

/** Start checking for new mail; call when the mailbox appears on screen. */
function start() {
  stop()
  void load()
  void refreshLabels()
  void harvestRecipients()

  const poll = setInterval(() => {
    if (navigator.onLine && (!document.hidden || getSettings().notifications)) void load({ quiet: true })
  }, POLL_MS)
  const onVisible = () => {
    if (!document.hidden && Date.now() - lastLoadAt > 30_000) void load({ quiet: true })
  }
  const onOnline = () => {
    set({ online: true })
    void load({ quiet: true })
  }
  const onOffline = () => set({ online: false })
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  stopRunning = () => {
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

/** Sign out, and forget the mail kept on this device. */
function leave() {
  try {
    localStorage.removeItem(savedKey(state.me.email))
  } catch {
    // Nothing to remove.
  }
  stop()
  viewCache.clear()
  state = blank({ name: '', email: '' })
  document.title = 'דואר'
  void signOut()
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
  toggleSelect,
  clearSelection: () => set({ selection: EMPTY }),
  clearArrived: () => state.arrived.size && set({ arrived: EMPTY }),
  compose,
  closeCompose,
  reply: (message: Message, mode: 'reply' | 'replyAll' | 'forward') => compose(replyDraft(message, mode, state.me)),
  editDraft,
  discardDraft,
  send,
  endFlight: () => set({ flight: null }),
  signOut: leave,
}
