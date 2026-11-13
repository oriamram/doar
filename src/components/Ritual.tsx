import { useEffect, useMemo, useRef, useState } from 'react'
import { shortName } from '../lib/addresses'
import { countLetters, formatWhen } from '../lib/format'
import { peekMessages } from '../lib/gmail'
import { useBackLayer } from '../lib/layers'
import { mailbox, useMailbox } from '../lib/mailbox'
import { ritualSize, type RitualItem } from '../lib/ritual'
import { playSound } from '../lib/sound'
import { BUNDLE_TITLES } from '../lib/views'
import type { Thread } from '../types'
import { ArchiveIcon, CheckIcon, CloseIcon, HoldIcon, MailOpenIcon, ReplyIcon, TrashIcon } from './icons'
import { SenderStamp } from './Postal'
import { ThreadView } from './ThreadView'

type Props = {
  queue: RitualItem[]
  onClose: () => void
  /** Ask when to bring a letter back (the held-mail form). */
  onHold: (ids: string[]) => void
  /** A layer above the ritual is open (a form, the writing form): its keys are not the ritual's. */
  busy: boolean
}

/**
 * Opening the mail: one letter at a time, already open, with its four answers under
 * the thumb. A letter that leaves the inbox (filed, binned, held, returned) makes way
 * for the next by itself. After the last one, the desk is clear.
 */
export function Ritual({ queue, onClose, onHold, busy }: Props) {
  const { threads, bundles, reminders } = useMailbox()
  // How far the reader has come by hand ("keep" moves on without anything leaving the inbox).
  const [passed, setPassed] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  useBackLayer(true, onClose)

  // Letters by id, as they are right now.
  const byId = useMemo(() => {
    const all = new Map<string, Thread>()
    for (const thread of [...(threads ?? []), ...bundles.flatMap((bundle) => bundle.threads)]) all.set(thread.id, thread)
    return all
  }, [threads, bundles])
  const inInbox = (id: string) => byId.get(id)?.labelIds.includes('INBOX') ?? false
  // A stop is done when its letter left the inbox (filed, binned, held, returned), or its bundle was filed or read.
  const isDone = (stop: RitualItem) => (stop.kind === 'letter' ? !inInbox(stop.id) : stop.ids.every((id) => !inInbox(id) || !byId.get(id)!.unread))
  let index = passed
  while (index < queue.length && isDone(queue[index]!)) index++
  const item = queue[index]
  const current = item?.kind === 'letter' ? byId.get(item.id) : undefined
  const waiting = item?.kind === 'bundle' ? item.ids.filter(inInbox) : []
  const next = () => setPassed(index + 1)

  // A letter shown is a letter read; each one starts at its top.
  const currentId = current?.id
  useEffect(() => {
    if (!currentId) return
    mailbox.setRead([currentId], true)
    scroller.current?.scrollTo({ top: 0 })
  }, [currentId])

  const done = index >= queue.length
  const left = ritualSize(queue.slice(index))
  const total = ritualSize(queue)

  // The ritual's own keys: r, e, b, # and Escape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'Escape') return onClose()
      if (!current) return
      const latest = peekMessages(current)?.findLast((message) => !message.isDraft)
      if (event.key === 'r' && latest) mailbox.reply(latest, 'reply')
      else if (event.key === 'e') mailbox.archive([current.id])
      else if (event.key === 'b') onHold([current.id])
      else if (event.key === '#' || event.key === 'Delete') mailbox.trash([current.id])
      else if (event.key === ' ') setPassed(index + 1)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, current, index, onClose, onHold])

  if (done) return <ClearDesk opened={total} returning={reminders.filter((reminder) => reminder.status === 'waiting' && reminder.kind === 'hold').map((reminder) => reminder.dueAt)} onClose={onClose} />

  const reply = () => {
    const latest = current && peekMessages(current)?.findLast((message) => !message.isDraft)
    if (latest) mailbox.reply(latest, 'reply')
  }

  return (
    <div className="ritual" role="dialog" aria-modal="true" aria-label="פתיחת הדואר">
      <header className="ritual-bar">
        <button className="icon-btn" onClick={onClose} aria-label="לסיים את פתיחת הדואר" title="לסיים (Esc)">
          <CloseIcon />
        </button>
        <span className="ritual-title">פתיחת הדואר</span>
        <span className="ritual-count" aria-live="polite">
          {left === 1 ? 'נשאר מכתב אחד' : `נשארו ${left} מכתבים`}
        </span>
        {/* The pile that is left, as the edges of the letters in it. */}
        <span className="ritual-pile" aria-hidden="true">
          {Array.from({ length: Math.min(left, 12) }, (_, edge) => (
            <span key={edge} />
          ))}
        </span>
      </header>

      <div className="ritual-desk" ref={scroller}>
        {current && <ThreadView key={current.id} thread={current} bare onBack={onClose} onLabels={() => {}} onHold={() => onHold([current.id])} onRegister={() => {}} onPerson={() => {}} />}
        {item?.kind === 'bundle' && (
          <div className="ritual-bundle">
            <span className="bundle-tag">{BUNDLE_TITLES[item.category]}</span>
            <h2>{countLetters(waiting.length)} בצרור</h2>
            <ul>
              {waiting.slice(0, 8).map((id) => {
                const thread = byId.get(id)!
                return (
                  <li key={id}>
                    <SenderStamp contact={thread.from} />
                    <span className="ritual-bundle-text">
                      <strong className="ellipsis" dir="auto">
                        {shortName(thread.from)}
                      </strong>
                      <span className="ellipsis" dir="auto">
                        {thread.subject}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
            {waiting.length > 8 && <p className="muted">ועוד {waiting.length - 8}.</p>}
          </div>
        )}
      </div>

      <div className="ritual-tickets">
        {current && (
          <>
            <button className="ticket ticket-main" onClick={reply}>
              <ReplyIcon />
              השב
            </button>
            <button className="ticket" onClick={() => mailbox.archive([current.id])}>
              <ArchiveIcon />
              לתיוק
            </button>
            <button className="ticket" onClick={() => onHold([current.id])}>
              <HoldIcon />
              אחר כך
            </button>
            <button className="ticket" onClick={() => mailbox.trash([current.id])}>
              <TrashIcon />
              לפח
            </button>
            <button className="ticket ticket-keep" onClick={next} title="להשאיר בדואר הנכנס ולהמשיך (רווח)">
              <CheckIcon />
              להשאיר
            </button>
          </>
        )}
        {item?.kind === 'bundle' && (
          <>
            <button className="ticket ticket-main" onClick={() => mailbox.archive(waiting)}>
              <ArchiveIcon />
              לתייק הכל
            </button>
            <button className="ticket" onClick={() => mailbox.setRead(waiting, true)}>
              <MailOpenIcon />
              נקרא
            </button>
            <button
              className="ticket"
              onClick={() => {
                mailbox.show({ kind: 'bundle', category: item.category })
                onClose()
              }}
            >
              לפתוח את הצרור
            </button>
          </>
        )}
      </div>
    </div>
  )
}

type ClearProps = { opened: number; returning: string[]; onClose: () => void }

/** The end of the ritual: the lamp warms, and the date stamp "אין דואר" lands on the blotter. */
function ClearDesk({ opened, returning, onClose }: ClearProps) {
  const [now] = useState(() => new Date())
  const soon = returning.filter((due) => Date.parse(due) - now.getTime() < 36 * 3_600_000).sort()
  useEffect(() => {
    const timer = setTimeout(() => playSound('thump'), 520)
    const onKey = (event: KeyboardEvent) => (event.key === 'Escape' || event.key === 'Enter') && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    <div className="ritual clear-desk" role="dialog" aria-modal="true" aria-label="השולחן נקי">
      <span className="clear-lamp" aria-hidden="true" />
      <div className="blotter">
        <span className="clear-stamp" role="img" aria-label="אין דואר">
          <span className="clear-stamp-top">אין דואר</span>
          <span className="clear-stamp-date" dir="ltr">
            {pad(now.getDate())}.{pad(now.getMonth() + 1)}.{now.getFullYear()}
          </span>
          <span className="clear-stamp-bottom">DOAR</span>
        </span>
      </div>
      <div className="clear-text">
        <h2>השולחן נקי</h2>
        <p>{opened === 1 ? 'מכתב אחד נפתח וטופל.' : `${opened} מכתבים נפתחו וטופלו.`}</p>
        <p className="clear-soon">{soon.length === 0 ? 'שום דבר לא מחכה לחזור מחר.' : soon.length === 1 ? `מכתב שמור אחד יחזור ${formatWhen(soon[0]!)}.` : `${soon.length} מכתבים שמורים יחזרו, הראשון ${formatWhen(soon[0]!)}.`}</p>
        <button className="pill-btn clear-back" onClick={onClose} autoFocus>
          חזרה לשולחן
        </button>
      </div>
    </div>
  )
}
