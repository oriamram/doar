import { useEffect, useMemo, useState } from 'react'
import { formatCode } from '../../../../supabase/functions/postman/codes.ts'
import { shortName } from '../lib/addresses'
import { copyText } from '../lib/clipboard'
import { formatAgo } from '../lib/format'
import { getAttachmentBytes } from '../lib/gmail'
import { calendarLink, formatAmount, isFresh, KIND_NAMES, parseInvite, STATUS_TEXT, type Invite, type Kind, type Shape } from '../lib/kinds'
import { mailbox } from '../lib/mailbox'
import { toast } from '../lib/toast'
import { useNow } from '../lib/useNow'
import type { Contact, Message, Thread } from '../types'
import { CalendarIcon, CopyIcon, ParcelIcon, SpikeIcon } from './icons'

async function copyCode(code: string, threadId: string) {
  if (!(await copyText(code))) return toast('ההעתקה לא הצליחה במכשיר הזה.', { tone: 'error' })
  toast(mailbox.codeCopied(threadId) ? 'הקוד הועתק. בעוד רבע שעה המכתב יעבור לאשפה.' : 'הקוד הועתק')
}

// ---------- In the list ----------

/** What a shaped letter shows in the list in place of its first words. */
export function KindLine({ shape, date }: { shape: Shape; date: string }) {
  switch (shape.kind) {
    case 'code':
      return (
        <span className="kind-line kind-code" data-stale={!isFresh(date) || undefined}>
          <span className="code-digits" dir="ltr">
            {formatCode(shape.code)}
          </span>
          <span className="kind-note">{isFresh(date) ? 'קוד חד־פעמי' : 'קוד ישן, כנראה כבר לא בתוקף'}</span>
        </span>
      )
    case 'parcel':
      return (
        <span className="kind-line kind-parcel">
          <ParcelIcon />
          <span className="parcel-status" data-status={shape.status ?? undefined}>
            {shape.status ? STATUS_TEXT[shape.status] : 'חבילה'}
          </span>
          {shape.number && (
            <span className="parcel-number ellipsis" dir="ltr">
              {shape.number}
            </span>
          )}
        </span>
      )
    default:
      return null
  }
}

/** The copy button beside a code's letter in the list. */
export function CodeCopy({ code, threadId }: { code: string; threadId: string }) {
  return (
    <button type="button" className="row-copy" onClick={() => void copyCode(code, threadId)} aria-label={`העתקת הקוד ${code}`} title="העתקת הקוד">
      <CopyIcon />
      העתקה
    </button>
  )
}

// ---------- On the counter (the top of the inbox) ----------

/** A fresh one-time code as a queue ticket: big digits, one press copies them. */
export function QueueTicket({ thread, code, now }: { thread: Thread; code: string; now: number }) {
  return (
    <div className="queue-ticket">
      <button type="button" className="qt-open" onClick={() => mailbox.open(thread)} aria-label={`פתיחת המכתב מ־${shortName(thread.from)}`}>
        <span className="qt-head ellipsis" dir="auto">
          {shortName(thread.from)}
        </span>
        <span className="qt-digits" dir="ltr">
          {formatCode(code)}
        </span>
        <span className="qt-foot">קוד חד־פעמי · {formatAgo(thread.date, new Date(now))}</span>
      </button>
      <button
        type="button"
        className="qt-copy"
        onClick={() => {
          void copyCode(code, thread.id)
          if (thread.unread) mailbox.setRead([thread.id], true)
        }}
      >
        <CopyIcon />
        העתקה
      </button>
    </div>
  )
}

/** "2 חבילות בדרך": the parcels the inbox knows about, behind one strip. */
export function ParcelStrip({ parcels }: { parcels: { thread: Thread; shape: Extract<Shape, { kind: 'parcel' }> }[] }) {
  const [open, setOpen] = useState(false)
  if (parcels.length === 0) return null
  const waiting = parcels.filter((item) => item.shape.status === 'ready').length
  const title = parcels.length === 1 ? 'חבילה אחת בדרך' : `${parcels.length} חבילות בדרך`
  return (
    <div className="parcel-strip" data-open={open || undefined}>
      <button type="button" className="parcel-strip-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ParcelIcon />
        <span>{waiting > 0 && waiting === parcels.length ? (waiting === 1 ? 'חבילה אחת ממתינה לאיסוף' : `${waiting} חבילות ממתינות לאיסוף`) : title}</span>
        {waiting > 0 && waiting < parcels.length && <span className="parcel-strip-note">{waiting === 1 ? 'אחת ממתינה לאיסוף' : `${waiting} ממתינות לאיסוף`}</span>}
      </button>
      {open && (
        <ul className="parcel-list">
          {parcels.map(({ thread, shape }) => (
            <li key={thread.id}>
              <button type="button" onClick={() => mailbox.open(thread)}>
                <span className="parcel-from ellipsis" dir="auto">
                  {shortName(thread.from)}
                </span>
                <span className="parcel-status" data-status={shape.status ?? undefined}>
                  {shape.status ? STATUS_TEXT[shape.status] : ''}
                </span>
                {shape.number && (
                  <span className="parcel-number" dir="ltr">
                    {shape.number}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- On an open letter ----------

/** The page a parcel's letter offers for following it: the link that says so, or that carries the number. */
function trackingLink(html: string, number: string | null): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')]
  const says = (link: HTMLAnchorElement) => /מעקב|לעקוב|track|follow\s+your|where.?s\s+my/i.test(`${link.textContent} ${link.getAttribute('href')}`)
  const found = links.find((link) => number && link.getAttribute('href')!.includes(number)) ?? links.find(says)
  return found?.getAttribute('href') ?? null
}

const isCalendarFile = (file: { mimeType: string; filename: string }) => /^(?:text\/calendar|application\/ics)$/i.test(file.mimeType) || /\.ics$/i.test(file.filename)

/** The event a letter invites to: from the calendar text inside it, or from an attached calendar file. */
function useInvite(message: Message, wanted: boolean): Invite | null {
  const inline = useMemo(() => (wanted && message.calendar ? parseInvite(message.calendar) : null), [message, wanted])
  const [fetched, setFetched] = useState<Invite | null>(null)
  const file = wanted && !inline ? message.attachments.find(isCalendarFile) : undefined
  useEffect(() => {
    if (!file) return
    let cancelled = false
    getAttachmentBytes(file).then(
      (bytes) => !cancelled && setFetched(parseInvite(new TextDecoder().decode(bytes))),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [file])
  return inline ?? fetched
}

function InviteCard({ invite }: { invite: Invite }) {
  const { start, end, allDay } = invite
  const time = (date: Date) => date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  const sameDay = !end || end.toDateString() === start.toDateString() || (allDay && end.getTime() - start.getTime() <= 86_400_000)
  const when = allDay
    ? sameDay
      ? 'כל היום'
      : `עד ${new Date(end!.getTime() - 86_400_000).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}`
    : end && sameDay
      ? `${time(start)} עד ${time(end)}`
      : time(start)
  return (
    <>
      <span className="invite-date" aria-hidden="true">
        <span className="invite-month">{start.toLocaleDateString('he-IL', { month: 'short' })}</span>
        <span className="invite-day">{start.getDate()}</span>
        <span className="invite-weekday">{start.toLocaleDateString('he-IL', { weekday: 'short' })}</span>
      </span>
      <span className="kind-main">
        <span className="kind-title" dir="auto">
          {invite.cancelled ? 'בוטל: ' : ''}
          {invite.title || 'הזמנה'}
        </span>
        <span className="kind-sub">
          {start.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })} · {when}
        </span>
        {invite.location && (
          <span className="kind-sub" dir="auto">
            {invite.location}
          </span>
        )}
      </span>
      {!invite.cancelled && (
        <a className="kind-action" href={calendarLink(invite)} target="_blank" rel="noopener noreferrer">
          <CalendarIcon />
          ליומן
        </a>
      )}
    </>
  )
}

type CardProps = {
  /** The letter the card is about (the latest one that isn't yours). */
  message: Message
  shape: Shape
  /** "This is not a code": the reader's correction, remembered for the sender. */
  onNot: (kind: Kind, sender: Contact) => void
}

/** The object a shaped letter is, shown above it: the ticket, the delivery slip, the receipt, the card. */
export function KindCard({ message, shape, onNot }: CardProps) {
  const now = useNow()
  const invite = useInvite(message, shape.kind === 'invitation')
  const parcelNumber = shape.kind === 'parcel' ? shape.number : undefined
  // Only a parcel's letter is searched for a tracking page (`undefined`: not a parcel).
  const link = useMemo(() => (parcelNumber === undefined ? null : trackingLink(message.bodyHtml, parcelNumber)), [message.bodyHtml, parcelNumber])
  if (shape.kind === 'letter' || shape.kind === 'leaflet') return null
  // An invitation we could not read stays a plain letter.
  if (shape.kind === 'invitation' && !invite) return null
  const fresh = isFresh(message.date, now)

  return (
    <div className="kind-card" data-kind={shape.kind} data-stale={(shape.kind === 'code' && !fresh) || undefined}>
      {shape.kind === 'code' && (
        <>
          <span className="kind-main">
            <span className="kind-label">קוד חד־פעמי</span>
            <span className="qt-digits" dir="ltr">
              {formatCode(shape.code)}
            </span>
            <span className="kind-sub">{fresh ? `התקבל ${formatAgo(message.date, new Date(now))}` : `התקבל ${formatAgo(message.date, new Date(now))}. קודים כאלה תקפים לרוב דקות ספורות.`}</span>
          </span>
          <button type="button" className="kind-action" onClick={() => void copyCode(shape.code, message.threadId)}>
            <CopyIcon />
            העתקה
          </button>
        </>
      )}
      {shape.kind === 'parcel' && (
        <>
          <span className="kind-main">
            <span className="kind-label">הודעה על דבר דואר</span>
            <span className="slip-rows">
              <span className="slip-key">מוביל</span>
              <span className="slip-value" dir="auto">
                {shortName(message.from)}
              </span>
              {shape.status && (
                <>
                  <span className="slip-key">מצב</span>
                  <span className="slip-value parcel-status" data-status={shape.status}>
                    {STATUS_TEXT[shape.status]}
                  </span>
                </>
              )}
              {shape.number && (
                <>
                  <span className="slip-key">מספר</span>
                  <button
                    type="button"
                    className="slip-value slip-number"
                    dir="ltr"
                    title="לחיצה מעתיקה"
                    onClick={() => void copyText(shape.number!).then((done) => toast(done ? 'מספר המשלוח הועתק' : 'ההעתקה לא הצליחה במכשיר הזה.', done ? {} : { tone: 'error' }))}
                  >
                    {shape.number}
                  </button>
                </>
              )}
            </span>
          </span>
          {link && (
            <a className="kind-action" href={link} target="_blank" rel="noopener noreferrer">
              <ParcelIcon />
              מעקב
            </a>
          )}
        </>
      )}
      {shape.kind === 'receipt' && (
        <>
          <span className="kind-main">
            <span className="kind-label">קבלה · {shortName(message.from)}</span>
            {shape.amount ? (
              <span className="receipt-total">
                <span>סה״כ</span>
                <span className="receipt-sum">{formatAmount(shape.amount)}</span>
              </span>
            ) : (
              <span className="kind-sub">הסכום לא נמצא במכתב.</span>
            )}
          </span>
          {/* Every receipt stands on the spike by itself, so the button only goes there. It used to
              file the letter under the name "to the spike", which read as "put this receipt there":
              the letter closed and a note said it was filed, and the owner asked why. */}
          <button type="button" className="kind-action" onClick={() => window.dispatchEvent(new Event('doar:spike'))} title="דוקרן הקבלות: כל הקבלות של השנה, לפי חודש">
            <SpikeIcon />
            כל הקבלות
          </button>
        </>
      )}
      {shape.kind === 'invitation' && invite && <InviteCard invite={invite} />}
      <button type="button" className="kind-not" onClick={() => onNot(shape.kind, message.from)}>
        זה לא {KIND_NAMES[shape.kind]}
      </button>
    </div>
  )
}

/** A small tag that names a letter's kind in the list (an invitation, a receipt's sum). */
export function KindTag({ shape }: { shape: Shape }) {
  if (shape.kind === 'invitation')
    return (
      <span className="kind-tag" data-kind="invitation">
        <CalendarIcon />
        הזמנה
      </span>
    )
  if (shape.kind === 'receipt')
    return (
      <span className="kind-tag" data-kind="receipt">
        {shape.amount ? formatAmount(shape.amount) : 'קבלה'}
      </span>
    )
  return null
}
