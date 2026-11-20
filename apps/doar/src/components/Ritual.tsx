import { useDrag } from '@use-gesture/react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { shortName } from '../lib/addresses'
import { countLetters, formatListDate, formatWhen } from '../lib/format'
import { loadMessages, peekMessages } from '../lib/gmail'
import { threadShape } from '../lib/kinds'
import { useBackLayer } from '../lib/layers'
import { mailbox, useMailbox } from '../lib/mailbox'
import { tapHaptic } from '../lib/platform'
import type { RitualItem } from '../lib/ritual'
import { useSettings } from '../lib/settings'
import { playSound } from '../lib/sound'
import { BUNDLE_TITLES } from '../lib/views'
import type { Contact, Message, Thread } from '../types'
import { ArchiveIcon, BackIcon, CheckIcon, CloseIcon, HoldIcon, ReplyIcon, TrashIcon } from './icons'
import { KindLine, KindTag } from './Kinds'
import { SenderStamp } from './Postal'
import { ThreadView } from './ThreadView'

type Props = {
  queue: RitualItem[]
  onClose: () => void
  /** Ask when to bring a letter back (the held-mail form). */
  onHold: (ids: string[]) => void
  /** Open a sender's card. */
  onPerson: (contact: Contact) => void
  /** Ask how long to wait for an answer to a sent letter. */
  onRegister: (threadId: string, messageId: string) => void
  /** A layer above the ritual is open (a form, the writing form): its keys are not the ritual's. */
  busy: boolean
}

/** What can be decided about a letter. */
type Answer = 'file' | 'read' | 'bin' | 'later' | 'reply'

/** Fraction of the card's width a swipe must pass to count. */
const THRESHOLD = 0.28

/**
 * Opening the mail: the new letters as a pile of cards, one on top. Swipe the top card left
 * to file it, right to mark it read and keep it; press it to read the whole letter. A letter
 * that leaves the inbox (filed, binned, held) makes way for the next by itself, and its undo
 * note brings the card back. After the last one, the desk is clear.
 */
export function Ritual({ queue, onClose, onHold, onPerson, onRegister, busy }: Props) {
  const { threads, bundles, reminders } = useMailbox()
  const { notKinds } = useSettings()
  // How far the reader has come by hand ("read" moves on without anything leaving the inbox).
  const [passed, setPassed] = useState(0)
  // The letter opened in full, if any. A new top card is a card again, not an open letter.
  const [openId, setOpenId] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  useBackLayer(true, onClose)

  // Letters by id, as they are right now.
  const byId = useMemo(() => {
    const all = new Map<string, Thread>()
    for (const thread of [...(threads ?? []), ...bundles.flatMap((bundle) => bundle.threads)]) all.set(thread.id, thread)
    return all
  }, [threads, bundles])
  // A card is done when its letter left the inbox (filed, binned, held).
  const isDone = (item: RitualItem) => !(byId.get(item.id)?.labelIds.includes('INBOX') ?? false)
  let index = passed
  while (index < queue.length && isDone(queue[index]!)) index++
  const item = queue[index]
  const current = item ? byId.get(item.id) : undefined
  const after = queue.slice(index + 1).filter((other) => !isDone(other))
  const behind = after[0] ? byId.get(after[0].id) : undefined
  const left = current ? after.length + 1 : 0

  const currentId = current?.id
  const reading = !!currentId && openId === currentId
  const setReading = (open: boolean) => setOpenId(open && currentId ? currentId : null)
  useBackLayer(reading, () => setOpenId(null))
  // A letter opened in full is a letter read; it starts at its top.
  useEffect(() => {
    if (!reading || !currentId) return
    mailbox.setRead([currentId], true)
    scroller.current?.scrollTo({ top: 0 })
  }, [reading, currentId])

  const answer = (what: Answer) => {
    if (!current) return
    const id = current.id
    tapHaptic()
    switch (what) {
      case 'file':
        mailbox.setRead([id], true)
        mailbox.archive([id])
        break
      case 'read':
        mailbox.setRead([id], true)
        setPassed(index + 1)
        break
      case 'bin':
        mailbox.trash([id])
        break
      case 'later':
        onHold([id])
        break
      case 'reply': {
        // The reply needs the letter itself: it opens, and the writing form opens over it.
        setReading(true)
        const reply = (messages: Message[] | null | undefined) => {
          const latest = messages?.findLast((message) => !message.isDraft)
          if (latest) mailbox.reply(latest, 'reply')
        }
        const known = peekMessages(current)
        if (known) reply(known)
        else void loadMessages(current).then(reply, () => {})
        break
      }
    }
  }

  // The ritual's own keys: ← files, → read, Enter opens, r e b # space, and Escape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'Escape') return reading ? setReading(false) : onClose()
      if (!current) return
      const keys: Record<string, Answer> = { ArrowLeft: 'file', e: 'file', ArrowRight: 'read', ' ': 'read', '#': 'bin', Delete: 'bin', b: 'later', r: 'reply' }
      if (event.key === 'Enter' && !reading) setReading(true)
      else if (keys[event.key]) answer(keys[event.key]!)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current) return <ClearDesk opened={queue.length} returning={reminders.filter((reminder) => reminder.status === 'waiting' && reminder.kind === 'hold').map((reminder) => reminder.dueAt)} onClose={onClose} />

  return (
    <div className="ritual" role="dialog" aria-modal="true" aria-label="פתיחת הדואר">
      <header className="ritual-bar">
        {reading ? (
          <button className="icon-btn" onClick={() => setReading(false)} aria-label="חזרה לכרטיסים" title="חזרה לכרטיסים (Esc)">
            <BackIcon />
          </button>
        ) : (
          <button className="icon-btn" onClick={onClose} aria-label="לסיים את פתיחת הדואר" title="לסיים (Esc)">
            <CloseIcon />
          </button>
        )}
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

      {reading ? (
        <div className="ritual-desk" ref={scroller}>
          <ThreadView key={current.id} thread={current} bare onBack={() => setReading(false)} onLabels={() => {}} onHold={() => onHold([current.id])} onRegister={(messageId) => onRegister(current.id, messageId)} onPerson={onPerson} />
        </div>
      ) : (
        <div className="ritual-stack">
          <div className="ritual-pile-cards">
            {behind && <LetterCard key={`behind-${behind.id}`} thread={behind} bundle={after[0]!.bundle} notKinds={notKinds} under />}
            <SwipeCard key={current.id} onAnswer={answer} onOpen={() => setReading(true)}>
              <LetterCard thread={current} bundle={item!.bundle} notKinds={notKinds} />
            </SwipeCard>
          </div>
          <p className="ritual-hint">החליקו שמאלה לתיוק, ימינה לנקרא. לחיצה על המכתב פותחת אותו.</p>
        </div>
      )}

      {/* Laid out left to right like the swipes: filing on the left, "read" on the right. */}
      <div className="ritual-tickets">
        <button className="ticket ticket-file" onClick={() => answer('file')} title="לתיוק (←)">
          <ArchiveIcon />
          לתיוק
        </button>
        <button className="ticket" onClick={() => answer('bin')} title="לפח (#)">
          <TrashIcon />
          לפח
        </button>
        <button className="ticket" onClick={() => answer('later')} title="אחר כך (b)">
          <HoldIcon />
          אחר כך
        </button>
        <button className="ticket" onClick={() => answer('reply')} title="השב (r)">
          <ReplyIcon />
          השב
        </button>
        <button className="ticket ticket-main" onClick={() => answer('read')} title="נקרא, נשאר בדואר הנכנס (→)">
          <CheckIcon />
          נקרא
        </button>
      </div>
    </div>
  )
}

type SwipeProps = { onAnswer: (what: Answer) => void; onOpen: () => void; children: ReactNode }

/** The top card: it follows the finger (or the mouse), tilts, and flies off when let go far enough. */
function SwipeCard({ onAnswer, onOpen, children }: SwipeProps) {
  const card = useRef<HTMLDivElement>(null)
  const still = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useTransform(x, [-300, 300], [-14, 14])
  const fileStamp = useTransform(x, [-110, -20], [1, 0])
  const readStamp = useTransform(x, [20, 110], [0, 1])
  const armed = useRef<'file' | 'read' | null>(null)

  const bind = useDrag(
    ({ down, tap, movement: [mx, my], velocity: [vx], direction: [dx] }) => {
      if (tap) return onOpen()
      const width = card.current?.offsetWidth ?? 320
      const side = mx < 0 ? 'file' : 'read'
      const past = Math.abs(mx) > width * THRESHOLD
      if (down) {
        x.set(mx)
        y.set(my * 0.25)
        const now = past ? side : null
        if (now !== armed.current) {
          armed.current = now
          if (now) tapHaptic()
        }
        return
      }
      armed.current = null
      const flung = vx > 0.5 && Math.sign(dx) === Math.sign(mx) && Math.abs(mx) > 30
      if (past || flung) {
        playSound('paper')
        const away = Math.sign(mx) * (window.innerWidth + width)
        if (still) return onAnswer(side)
        void animate(x, away, { duration: 0.22, ease: 'easeIn' }).then(() => onAnswer(side))
        return
      }
      void animate(x, 0, { type: 'spring', stiffness: 520, damping: 34 })
      void animate(y, 0, { type: 'spring', stiffness: 520, damping: 34 })
    },
    { filterTaps: true },
  )

  return (
    <motion.div
      ref={card}
      className="ritual-card-holder"
      style={{ x, y, rotate, touchAction: 'pan-y' }}
      {...(bind() as object)}
      role="button"
      tabIndex={0}
      aria-label="המכתב העליון: החליקו שמאלה לתיוק, ימינה לנקרא, או לחצו כדי לפתוח"
    >
      {children}
      <motion.span className="rubber ritual-stamp ritual-stamp--file" style={{ opacity: fileStamp }} aria-hidden="true">
        לתיוק
      </motion.span>
      <motion.span className="rubber ritual-stamp ritual-stamp--read" style={{ opacity: readStamp }} aria-hidden="true">
        נקרא
      </motion.span>
    </motion.div>
  )
}

type CardProps = { thread: Thread; bundle?: RitualItem['bundle']; notKinds: Record<string, string[]>; under?: boolean }

/** A letter as a card: who, what, and its first words. */
function LetterCard({ thread, bundle, notKinds, under }: CardProps) {
  const shape = threadShape(thread, notKinds)
  return (
    <article className="ritual-card" data-under={under || undefined} data-kind={shape.kind} aria-hidden={under || undefined}>
      <header className="ritual-card-head">
        <SenderStamp contact={thread.from} size="lg" />
        <span className="ritual-card-who">
          <strong className="ellipsis" dir="auto">
            {shortName(thread.from)}
          </strong>
          <span className="ritual-card-date">{formatListDate(thread.date)}</span>
        </span>
        {bundle && <span className="bundle-tag">{BUNDLE_TITLES[bundle]}</span>}
      </header>
      <h2 className="ritual-card-subject" dir="auto">
        {thread.subject || '(בלי נושא)'}
      </h2>
      {(shape.kind === 'code' || shape.kind === 'parcel') && <KindLine shape={shape} date={thread.date} />}
      {(shape.kind === 'receipt' || shape.kind === 'invitation') && <KindTag shape={shape} />}
      {shape.kind !== 'code' && thread.snippet && (
        <p className="ritual-card-words" dir="auto">
          {thread.snippet}
        </p>
      )}
      {thread.messageCount > 1 && <span className="ritual-card-more">{countLetters(thread.messageCount)} בשיחה</span>}
    </article>
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
