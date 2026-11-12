import { useEffect, useState } from 'react'
import { formatFullDate, formatLetterDate, formatListDate as formatShortDate } from '../lib/format'
import { getThreadMessages } from '../lib/gmail'
import type { Message, Thread } from '../types'
import { EmailBody } from './EmailBody'
import { ArchiveIcon, BackIcon, StarIcon } from './icons'
import { DuplexCancel, GoldStar, SenderStamp } from './Postal'

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
        <button className="icon-btn back" onClick={onBack} aria-label="חזרה לדואר">
          <BackIcon />
        </button>
        <span className="spacer" />
        <button
          className="icon-btn"
          aria-label={thread.starred ? 'הסרת כוכב' : 'סימון בכוכב'}
          aria-pressed={thread.starred}
          onClick={onToggleStar}
        >
          <StarIcon filled={thread.starred} />
        </button>
        <button className="pill-btn" onClick={onArchive}>
          <ArchiveIcon />
          לתיוק
        </button>
      </header>

      <h2 className="thread-subject" dir="auto">
        {thread.subject}
      </h2>

      {error && <p className="error">לא הצלחנו לפתוח את המכתב. {error}</p>}
      {!messages && !error && <p className="muted">פותחים את המעטפה…</p>}

      {messages?.map((message, index) => {
        const open = expanded.has(message.id) || messages.length === 1
        const latest = index === messages.length - 1
        if (!open) {
          return (
            <section key={message.id} className="message">
              <button className="folded" onClick={() => toggle(message.id)} aria-expanded={false}>
                <span className="folded-who">
                  {message.from.name} · {formatShortDate(message.date)}
                </span>
                <span className="folded-snippet ellipsis" dir="auto">
                  {message.snippet}
                </span>
              </button>
            </section>
          )
        }
        return (
          <section key={message.id} className="message">
            <span className="flap" aria-hidden="true" />
            <button
              className="envelope"
              onClick={() => messages.length > 1 && toggle(message.id)}
              aria-expanded={true}
              aria-label={`מאת ${message.from.name}, ${formatFullDate(message.date)}`}
            >
              <span className="envelope-label">מאת</span>
              <span className="envelope-name ellipsis" dir="auto">
                {message.from.name}
              </span>
              <span className="envelope-addr ellipsis">{message.from.email}</span>
              {message.to && <span className="envelope-addr envelope-to ellipsis">אל: {message.to}</span>}
              <span className="envelope-date">{formatLetterDate(message.date)}</span>
              <span className="envelope-stamp">
                <SenderStamp contact={message.from} size="lg" />
                <DuplexCancel iso={message.date} />
              </span>
              {latest && thread.starred && <GoldStar className="envelope-star" />}
            </button>
            <div className="letter">
              <EmailBody html={message.bodyHtml} />
            </div>
          </section>
        )
      })}
    </article>
  )
}
