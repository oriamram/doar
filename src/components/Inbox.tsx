import { useCallback, useEffect, useState } from 'react'
import { signOut } from '../lib/auth'
import { archiveThread, listInbox, setThreadStarred, setThreadUnread } from '../lib/gmail'
import { ReauthRequiredError } from '../lib/googleToken'
import { formatListDate } from '../lib/format'
import { onAndroidBack } from '../lib/platform'
import type { Thread } from '../types'
import { ArchiveIcon, DraftIcon, InboxIcon, LogoutIcon, RefreshIcon, SendIcon, StarIcon } from './icons'
import { CountStamp, DoarMark, SenderStamp } from './Postal'
import { SwipeRow } from './SwipeRow'
import { ThreadView } from './ThreadView'

const todayLine = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

const folders = [
  { id: 'inbox', label: 'דואר נכנס', icon: <InboxIcon /> },
  { id: 'starred', label: 'מסומנים בכוכב', icon: <StarIcon /> },
  { id: 'sent', label: 'נשלחו', icon: <SendIcon /> },
  { id: 'drafts', label: 'טיוטות', icon: <DraftIcon /> },
  { id: 'archive', label: 'ארכיון', icon: <ArchiveIcon /> },
]

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Inbox({ email }: { email: string }) {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = threads?.find((t) => t.id === selectedId) ?? null
  const unreadCount = threads?.filter((t) => t.unread).length ?? 0

  const handleError = useCallback((e: unknown) => {
    if (e instanceof ReauthRequiredError) {
      void signOut()
      return
    }
    setError(message(e))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setThreads(await listInbox())
      setError(null)
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
    }
  }, [handleError])

  // First load when the inbox appears (Refresh calls `load` again).
  useEffect(() => {
    listInbox()
      .then(setThreads)
      .catch(handleError)
      .finally(() => setLoading(false))
  }, [handleError])

  const update = (id: string, patch: Partial<Thread>) =>
    setThreads((all) => all?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? null)

  /** Change the screen right away, then tell Gmail; if Gmail refuses, undo and reload. */
  const sync = (request: Promise<unknown>) =>
    request.catch((e) => {
      handleError(e)
      void load()
    })

  const open = (id: string) => {
    setSelectedId(id)
    const thread = threads?.find((t) => t.id === id)
    if (thread?.unread) {
      update(id, { unread: false })
      void sync(setThreadUnread(id, false))
    }
  }

  const toggleRead = (thread: Thread) => {
    update(thread.id, { unread: !thread.unread })
    void sync(setThreadUnread(thread.id, !thread.unread))
  }

  const toggleStar = (thread: Thread) => {
    update(thread.id, { starred: !thread.starred })
    void sync(setThreadStarred(thread.id, !thread.starred))
  }

  const archive = (id: string) => {
    const list = threads ?? []
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

  // Android back button closes the open email before leaving the app.
  useEffect(
    () =>
      onAndroidBack(() => {
        if (!selectedId) return false
        setSelectedId(null)
        return true
      }),
    [selectedId],
  )

  // PC keyboard shortcuts: j/k move, e archive, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!threads || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
      const i = threads.findIndex((t) => t.id === selectedId)
      if (e.key === 'j' && threads[i + 1]) open(threads[i + 1]!.id)
      else if (e.key === 'k' && i > 0) open(threads[i - 1]!.id)
      else if (e.key === 'e' && selectedId) archive(selectedId)
      else if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="app" data-view={selected ? 'thread' : 'list'}>
      <aside className="sidebar">
        <div className="brand">
          <DoarMark size={30} />
          דואר
        </div>
        <nav>
          {folders.map((f) => (
            <button key={f.id} className="nav-item" aria-current={f.id === 'inbox' ? 'page' : undefined}>
              {f.icon}
              <span>{f.label}</span>
              {f.id === 'inbox' && unreadCount > 0 && <span className="count">{unreadCount}</span>}
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

      <section className="list" aria-label="דואר נכנס">
        <header className="list-header">
          <div className="airmail-band" aria-hidden="true" />
          <div className="list-title">
            <span className="dateline">
              דואר · {todayLine}
              <button
                className="refresh"
                onClick={() => void load()}
                disabled={loading}
                data-spinning={loading || undefined}
                aria-label="בדיקת דואר חדש"
                title="בדיקת דואר חדש"
              >
                <RefreshIcon />
              </button>
            </span>
            <h1>הדואר של היום</h1>
          </div>
          {unreadCount > 0 && <CountStamp count={unreadCount} label="לא נקראו" />}
        </header>

        {error && (
          <div className="banner">
            <span>{error}</span>
            <button onClick={() => void load()}>נסה שוב</button>
          </div>
        )}

        <ul className="threads">
          {threads?.map((t) => (
            <li key={t.id}>
              <SwipeRow unread={t.unread} onArchive={() => archive(t.id)} onToggleRead={() => toggleRead(t)}>
                <button
                  className="thread-row"
                  data-unread={t.unread || undefined}
                  aria-current={t.id === selectedId || undefined}
                  onClick={() => open(t.id)}
                >
                  <SenderStamp contact={t.from} cancelled={!t.unread} seed={t.id} />
                  <span className="thread-main">
                    <span className="thread-top">
                      <span className="sender ellipsis" dir="auto">
                        {t.from.name}
                      </span>
                      {t.messageCount > 1 && <span className="msg-count">×{t.messageCount}</span>}
                      {t.starred && (
                        <span className="star-mark" aria-label="מסומן בכוכב">
                          <StarIcon filled />
                        </span>
                      )}
                      <span className="row-date">
                        {t.unread && <span className="visually-hidden">לא נקרא, </span>}
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
          {threads === null && !error && <li className="empty">אוספים את הדואר של היום…</li>}
          {threads?.length === 0 && <li className="empty">אין דואר היום. תיהנה מהשקט.</li>}
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
              <kbd>j</kbd>/<kbd>k</kbd> למעבר · <kbd>e</kbd> לתיוק
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
