import { useEffect, useState } from 'react'
import { formatFullDate, initials } from '../lib/format'
import { getThreadMessages } from '../lib/gmail'
import type { Message, Thread } from '../types'
import { EmailBody } from './EmailBody'
import { ArchiveIcon, BackIcon, StarIcon } from './icons'

// Opened conversations stay cached while the app is open, so going back and forth is instant.
const messageCache = new Map<string, Message[]>()

type Props = {
  thread: Thread
  onBack: () => void
  onArchive: () => void
  onToggleStar: () => void
}

export function ThreadView({ thread, onBack, onArchive, onToggleStar }: Props) {
  const [messages, setMessages] = useState<Message[] | null>(() => messageCache.get(thread.id) ?? null)
  const [error, setError] = useState<string | null>(null)
  // Older messages start collapsed to one line, like Gmail; the latest is open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // This component is keyed by thread id, so state starts fresh for every conversation.
  useEffect(() => {
    let cancelled = false
    getThreadMessages(thread.id)
      .then((loaded) => {
        if (cancelled) return
        messageCache.set(thread.id, loaded)
        setMessages(loaded)
        setExpanded(new Set([loaded.at(-1)!.id]))
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [thread.id])

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <article className="thread">
      <header className="reader-bar">
        <button className="icon-btn back" onClick={onBack} aria-label="Back to inbox">
          <BackIcon />
        </button>
        <span className="spacer" />
        <button
          className="icon-btn"
          aria-label={thread.starred ? 'Unstar' : 'Star'}
          aria-pressed={thread.starred}
          onClick={onToggleStar}
        >
          <StarIcon filled={thread.starred} />
        </button>
        <button className="icon-btn" aria-label="Archive" onClick={onArchive}>
          <ArchiveIcon />
        </button>
      </header>

      <h2 className="thread-subject">{thread.subject}</h2>

      {error && <p className="error">Couldn't load this conversation. {error}</p>}
      {!messages && !error && <p className="muted">Loading…</p>}

      {messages?.map((message) => {
        const open = expanded.has(message.id) || messages.length === 1
        return (
          <section key={message.id} className="message" data-open={open || undefined}>
            <button className="message-meta" onClick={() => toggle(message.id)} aria-expanded={open}>
              <span className="avatar">{initials(message.from.name)}</span>
              <span className="message-who">
                <span className="sender">{message.from.name}</span>
                <span className="muted">{open ? message.from.email : message.snippet}</span>
              </span>
              <span className="muted date">{formatFullDate(message.date)}</span>
            </button>
            {open && <EmailBody html={message.bodyHtml} />}
          </section>
        )
      })}
    </article>
  )
}
