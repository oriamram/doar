import { useCallback, useEffect, useState } from 'react'
import { signOut } from '../lib/auth'
import { formatListDate, initials } from '../lib/format'
import { archiveThread, listInbox, setThreadStarred, setThreadUnread } from '../lib/gmail'
import { ReauthRequiredError } from '../lib/googleToken'
import { onAndroidBack } from '../lib/platform'
import type { Thread } from '../types'
import { ArchiveIcon, DraftIcon, InboxIcon, LogoutIcon, RefreshIcon, SendIcon, StarIcon } from './icons'
import { SwipeRow } from './SwipeRow'
import { ThreadView } from './ThreadView'

const folders = [
  { id: 'inbox', label: 'Inbox', icon: <InboxIcon /> },
  { id: 'starred', label: 'Starred', icon: <StarIcon /> },
  { id: 'sent', label: 'Sent', icon: <SendIcon /> },
  { id: 'drafts', label: 'Drafts', icon: <DraftIcon /> },
  { id: 'archive', label: 'Archive', icon: <ArchiveIcon /> },
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
          <img src="/logo.svg" alt="" width={28} height={28} />
          Doar
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
          <button className="icon-btn" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
            <LogoutIcon />
          </button>
        </div>
      </aside>

      <section className="list" aria-label="Inbox">
        <header className="list-header">
          <h1>Inbox</h1>
          <button
            className="icon-btn"
            onClick={() => void load()}
            disabled={loading}
            data-spinning={loading || undefined}
            aria-label="Refresh"
          >
            <RefreshIcon />
          </button>
        </header>

        {error && (
          <div className="banner">
            <span>{error}</span>
            <button onClick={() => void load()}>Retry</button>
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
                  <span className="avatar">{initials(t.from.name)}</span>
                  <span className="thread-main">
                    <span className="thread-top">
                      <span className="sender">
                        {t.from.name}
                        {t.messageCount > 1 && <span className="msg-count"> {t.messageCount}</span>}
                      </span>
                      <span className="date">{formatListDate(t.date)}</span>
                    </span>
                    <span className="subject">{t.subject}</span>
                    <span className="snippet">{t.snippet}</span>
                  </span>
                </button>
              </SwipeRow>
            </li>
          ))}
          {threads === null && !error && <li className="empty">Loading your inbox…</li>}
          {threads?.length === 0 && <li className="empty">Inbox zero. Nice.</li>}
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
            <img src="/logo.svg" alt="" width={56} height={56} />
            <p>Select an email to read it</p>
            <p className="muted hint">
              <kbd>j</kbd>/<kbd>k</kbd> to move · <kbd>e</kbd> to archive
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
