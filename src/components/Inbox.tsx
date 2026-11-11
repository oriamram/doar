import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { signOut } from '../lib/auth'
import { archiveThread, inboxUnreadCount, listThreads, setThreadStarred, setThreadUnread } from '../lib/gmail'
import { ReauthRequiredError } from '../lib/googleToken'
import { formatListDate } from '../lib/format'
import { onAndroidBack } from '../lib/platform'
import type { Thread } from '../types'
import {
  ArchiveIcon,
  CloseIcon,
  DraftIcon,
  InboxIcon,
  LogoutIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  StarIcon,
} from './icons'
import { Loader } from './Loader'
import { DoarMark, SenderAvatar } from './Postal'
import { SwipeRow } from './SwipeRow'
import { ThreadView } from './ThreadView'

/** What the list shows: a folder, an inbox filter, or search results. Each is a Gmail search. */
type View =
  | { id: 'inbox' | 'unread' | 'starred' | 'sent' | 'drafts' | 'archive' }
  | { id: 'search'; query: string }

const QUERIES = {
  inbox: 'in:inbox',
  unread: 'in:inbox is:unread',
  starred: 'is:starred',
  sent: 'in:sent',
  drafts: 'in:drafts',
  archive: '-in:inbox -in:sent -in:drafts',
}

const TITLES = {
  inbox: 'דואר נכנס',
  unread: 'דואר נכנס',
  starred: 'מסומנים בכוכב',
  sent: 'נשלחו',
  drafts: 'טיוטות',
  archive: 'ארכיון',
  search: 'חיפוש',
}

const INBOX: View = { id: 'inbox' }

const folders = [
  { id: 'inbox', label: 'דואר נכנס', icon: <InboxIcon /> },
  { id: 'starred', label: 'מסומנים בכוכב', icon: <StarIcon /> },
  { id: 'sent', label: 'נשלחו', icon: <SendIcon /> },
  { id: 'drafts', label: 'טיוטות', icon: <DraftIcon /> },
  { id: 'archive', label: 'ארכיון', icon: <ArchiveIcon /> },
] as const

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function emptyText(view: View) {
  switch (view.id) {
    case 'unread':
      return 'הכל נקרא. אין מה להשלים.'
    case 'starred':
      return 'אין מכתבים מסומנים בכוכב.'
    case 'search':
      return `לא נמצא דואר עבור „${view.query}”.`
    case 'inbox':
      return 'תיבת הדואר ריקה. תיהנה מהשקט.'
    default:
      return 'אין כאן מכתבים.'
  }
}

export function Inbox({ email }: { email: string }) {
  const [view, setView] = useState<View>(INBOX)
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  // Answers to an older request (say, the user switched filters quickly) are dropped.
  const latestRequest = useRef(0)

  const selected = threads?.find((t) => t.id === selectedId) ?? null
  const inInbox = view.id === 'inbox' || view.id === 'unread'
  // The filter row stays up on every view it can switch to, so there's always a way back.
  const showFilters = inInbox || view.id === 'starred'

  const handleError = useCallback((e: unknown) => {
    if (e instanceof ReauthRequiredError) {
      void signOut()
      return
    }
    setError(message(e))
  }, [])

  /** Fetch a view. Callers set `loading` first, so the screen reacts at once. */
  const fetchView = useCallback(
    async (v: View) => {
      const request = ++latestRequest.current
      try {
        const query = v.id === 'search' ? v.query : QUERIES[v.id]
        const [list, unread] = await Promise.all([listThreads(query), inboxUnreadCount()])
        if (request !== latestRequest.current) return
        setThreads(list)
        setUnreadTotal(unread)
        setError(null)
      } catch (e) {
        if (request === latestRequest.current) handleError(e)
      } finally {
        if (request === latestRequest.current) setLoading(false)
      }
    },
    [handleError],
  )

  // First load when the inbox appears (later loads go through `fetchView`).
  useEffect(() => {
    const request = ++latestRequest.current
    Promise.all([listThreads(QUERIES.inbox), inboxUnreadCount()])
      .then(([list, unread]) => {
        if (request !== latestRequest.current) return
        setThreads(list)
        setUnreadTotal(unread)
      })
      .catch((e) => request === latestRequest.current && handleError(e))
      .finally(() => request === latestRequest.current && setLoading(false))
  }, [handleError])

  const show = (v: View) => {
    setView(v)
    setSelectedId(null)
    setLoading(true)
    void fetchView(v)
  }

  const reload = () => {
    setLoading(true)
    void fetchView(view)
  }

  const update = (id: string, patch: Partial<Thread>) =>
    setThreads((all) => all?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? null)

  /** Change the screen right away, then tell Gmail; if Gmail refuses, reload. */
  const sync = (request: Promise<unknown>) =>
    request.catch((e) => {
      handleError(e)
      reload()
    })

  const markUnread = (thread: Thread, unread: boolean) => {
    update(thread.id, { unread })
    if (inInbox) setUnreadTotal((n) => Math.max(0, n + (unread ? 1 : -1)))
    void sync(setThreadUnread(thread.id, unread))
  }

  const open = (id: string) => {
    setSelectedId(id)
    const thread = threads?.find((t) => t.id === id)
    if (thread?.unread) markUnread(thread, false)
  }

  const toggleStar = (thread: Thread) => {
    update(thread.id, { starred: !thread.starred })
    void sync(setThreadStarred(thread.id, !thread.starred))
  }

  const archive = (id: string) => {
    const list = threads ?? []
    const thread = list.find((t) => t.id === id)
    if (thread?.unread && inInbox) setUnreadTotal((n) => Math.max(0, n - 1))
    setThreads(list.filter((t) => t.id !== id))
    void sync(archiveThread(id))
    // Archiving the open email moves on to the next one, like Gmail's auto-advance.
    if (id === selectedId) {
      const i = list.findIndex((t) => t.id === id)
      const next = list[i + 1] ?? list[i - 1]
      if (next) open(next.id)
      else setSelectedId(null)
    }
  }

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const query = searchText.trim()
    if (query) show({ id: 'search', query })
  }

  const closeSearch = () => {
    setSearching(false)
    setSearchText('')
    if (view.id === 'search') show(INBOX)
  }

  // Android back button: close the open email, then search, before leaving the app.
  useEffect(
    () =>
      onAndroidBack(() => {
        if (selectedId) {
          setSelectedId(null)
          return true
        }
        if (searching) {
          closeSearch()
          return true
        }
        return false
      }),
  )

  // PC keyboard shortcuts: j/k move, e archive, / search, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!threads || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
      const i = threads.findIndex((t) => t.id === selectedId)
      if (e.key === 'j' && threads[i + 1]) open(threads[i + 1]!.id)
      else if (e.key === 'k' && i > 0) open(threads[i - 1]!.id)
      else if (e.key === 'e' && selectedId) archive(selectedId)
      else if (e.key === '/') {
        e.preventDefault()
        setSearching(true)
      } else if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // First open: one calm loader instead of an empty screen.
  if (threads === null && !error) return <Loader />

  const filters = [
    { view: INBOX, label: 'הכל' },
    { view: { id: 'unread' } as View, label: 'לא נקראו', count: unreadTotal },
    { view: { id: 'starred' } as View, label: 'מסומנים' },
  ]

  return (
    <div className="app" data-view={selected ? 'thread' : 'list'}>
      <aside className="sidebar">
        <div className="brand">
          <DoarMark size={30} />
          דואר
        </div>
        <nav>
          {folders.map((f) => (
            <button
              key={f.id}
              className="nav-item"
              aria-current={view.id === f.id || (f.id === 'inbox' && view.id === 'unread') ? 'page' : undefined}
              onClick={() => show({ id: f.id })}
            >
              {f.icon}
              <span>{f.label}</span>
              {f.id === 'inbox' && unreadTotal > 0 && <span className="count">{unreadTotal}</span>}
            </button>
          ))}
        </nav>
        <div className="account">
          <span className="muted account-email" title={email}>
            {email}
          </span>
          <button className="icon-btn" onClick={() => void signOut()} aria-label="התנתקות" title="התנתקות">
            <LogoutIcon />
          </button>
        </div>
      </aside>

      <section className="list" aria-label={TITLES[view.id]}>
        <header className="list-header">
          <div className="airmail-band" aria-hidden="true" />

          {searching ? (
            <form className="header-row search-row" role="search" onSubmit={submitSearch}>
              <SearchIcon />
              <input
                className="search-input"
                type="search"
                enterKeyHint="search"
                placeholder="חיפוש בכל הדואר"
                aria-label="חיפוש בכל הדואר"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                autoFocus
              />
              <button type="button" className="icon-btn" onClick={closeSearch} aria-label="סגירת החיפוש">
                <CloseIcon />
              </button>
            </form>
          ) : (
            <div className="header-row">
              <h1 className="view-title">{TITLES[view.id]}</h1>
              <button className="icon-btn" onClick={() => setSearching(true)} aria-label="חיפוש" title="חיפוש ( / )">
                <SearchIcon />
              </button>
              <button
                className="icon-btn"
                onClick={reload}
                disabled={loading}
                data-spinning={loading || undefined}
                aria-label="בדיקת דואר חדש"
                title="בדיקת דואר חדש"
              >
                <RefreshIcon />
              </button>
              <div className="account-menu">
                <button
                  className="me"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-expanded={menuOpen}
                  aria-label="החשבון שלי"
                >
                  {(email[0] ?? '?').toUpperCase()}
                </button>
                {menuOpen && (
                  <>
                    <button className="menu-backdrop" aria-label="סגירה" onClick={() => setMenuOpen(false)} />
                    <div className="menu" role="menu">
                      <span className="menu-email" dir="ltr">
                        {email}
                      </span>
                      <button role="menuitem" className="menu-item" onClick={() => void signOut()}>
                        <LogoutIcon />
                        התנתקות
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {showFilters && !searching && (
            <div className="filters" role="tablist" aria-label="סינון">
              {filters.map((f) => (
                <button
                  key={f.view.id}
                  role="tab"
                  className="filter"
                  aria-selected={view.id === f.view.id}
                  onClick={() => view.id !== f.view.id && show(f.view)}
                >
                  {f.label}
                  {!!f.count && <span className="filter-count">{f.count}</span>}
                </button>
              ))}
            </div>
          )}

          <span className="progress" data-active={loading || undefined} aria-hidden="true" />
        </header>

        {error && (
          <div className="banner">
            <span>{error}</span>
            <button onClick={reload}>נסה שוב</button>
          </div>
        )}

        <ul className="threads" data-stale={loading || undefined}>
          {threads?.map((t) => (
            <li key={t.id}>
              <SwipeRow unread={t.unread} onArchive={() => archive(t.id)} onToggleRead={() => markUnread(t, !t.unread)}>
                <button
                  className="thread-row"
                  data-unread={t.unread || undefined}
                  aria-current={t.id === selectedId || undefined}
                  onClick={() => open(t.id)}
                >
                  <SenderAvatar contact={t.from} read={!t.unread} />
                  <span className="thread-main">
                    <span className="thread-top">
                      <span className="sender ellipsis" dir="auto">
                        {t.from.name}
                      </span>
                      {t.messageCount > 1 && <span className="msg-count">{t.messageCount}</span>}
                      {t.starred && (
                        <span className="star-mark" aria-label="מסומן בכוכב">
                          <StarIcon filled />
                        </span>
                      )}
                      <span className="row-date">
                        <span className="visually-hidden">{t.unread ? 'לא נקרא, ' : 'נקרא, '}</span>
                        {formatListDate(t.date)}
                      </span>
                    </span>
                    <span className="subject ellipsis" dir="auto">
                      {t.subject}
                    </span>
                    <span className="snippet ellipsis" dir="auto">
                      {t.snippet}
                    </span>
                  </span>
                </button>
              </SwipeRow>
            </li>
          ))}
          {threads?.length === 0 && !loading && <li className="empty">{emptyText(view)}</li>}
        </ul>
      </section>

      <main className="reader">
        {selected ? (
          <ThreadView
            key={selected.id}
            thread={selected}
            onBack={() => setSelectedId(null)}
            onArchive={() => archive(selected.id)}
            onToggleStar={() => toggleStar(selected)}
          />
        ) : (
          <div className="reader-empty">
            <img src="/logo.svg" alt="" width={64} height={64} />
            <p className="big">בחר מכתב כדי לפתוח אותו</p>
            <p className="muted hint">
              <kbd>j</kbd>/<kbd>k</kbd> למעבר · <kbd>e</kbd> לתיוק · <kbd>/</kbd> לחיפוש
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
