import { useEffect, useState } from 'react'
import { matches } from '../../supabase/functions/postman/rules.ts'
import { sameEmail, shortName } from '../lib/addresses'
import { realAttachments } from '../lib/compose'
import { copyText } from '../lib/clipboard'
import { countDays, formatDay, formatFullDate, formatLetterDate, formatListDate, formatWhen } from '../lib/format'
import { loadMessages, peekMessages, sendRaw } from '../lib/gmail'
import { mailbox, useMailbox } from '../lib/mailbox'
import { buildMime } from '../lib/mime'
import { toast } from '../lib/toast'
import type { Contact, Message, Thread } from '../types'
import { Attachments } from './Attachments'
import { EmailBody } from './EmailBody'
import {
  ArchiveIcon,
  BackIcon,
  CopyIcon,
  ExpressIcon,
  ForwardIcon,
  HoldIcon,
  InboxIcon,
  MailIcon,
  MoreIcon,
  RegisteredIcon,
  ReplyAllIcon,
  ReplyIcon,
  RestoreIcon,
  SpamIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
} from './icons'
import { DuplexCancel, GoldStar, LabelTape, SenderStamp } from './Postal'

type CopyableProps = {
  text: string
  /** What the note says once it's copied. */
  done: string
  className: string
  dir: 'auto' | 'ltr'
  /** Show a small copy mark beside it, as a hint that it can be tapped. */
  hint?: boolean
}

/** A name or an address written on the envelope: tap it and it's copied. */
function Copyable({ text, done, className, dir, hint }: CopyableProps) {
  const copy = async () => {
    if (await copyText(text)) toast(done)
    else toast('ההעתקה לא הצליחה במכשיר הזה.', { tone: 'error' })
  }
  return (
    <button type="button" className={`copyable ${className}`} onClick={() => void copy()} title="לחיצה מעתיקה" aria-label={`העתקת ${text}`}>
      <span className="ellipsis" dir={dir}>
        {text}
      </span>
      {hint && <CopyIcon />}
    </button>
  )
}

type Props = {
  thread: Thread
  onBack: () => void
  onLabels: () => void
  /** Ask when to bring this letter back; `current` is the time it is held until, when changing it. */
  onHold: (current?: string) => void
  /** Ask how long to wait for an answer to this sent letter. */
  onRegister: (messageId: string) => void
}

/** Ask a mailing list to stop writing: by email when it accepts that, otherwise on its web page. */
async function unsubscribe(message: Message, me: Contact) {
  const { mailto, url } = message.unsubscribe ?? {}
  if (mailto) {
    const [address = '', query = ''] = mailto.split('?')
    const params = new URLSearchParams(query)
    try {
      await sendRaw(
        buildMime({
          from: me,
          to: [{ name: '', email: decodeURIComponent(address) }],
          cc: [],
          bcc: [],
          subject: params.get('subject') ?? 'unsubscribe',
          html: '<div>unsubscribe</div>',
          text: params.get('body') ?? 'unsubscribe',
          attachments: [],
        }),
      )
      toast('נשלחה בקשה להסרה מרשימת התפוצה')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), { tone: 'error' })
    }
  } else if (url) {
    window.open(url, '_blank', 'noopener')
  }
}

export function ThreadView({ thread, onBack, onLabels, onHold, onRegister }: Props) {
  const { labels, openRevision, me, reminders, marks } = useMailbox()
  const { id, historyId } = thread
  const [messages, setMessages] = useState<Message[] | null>(() => peekMessages(thread))
  const [error, setError] = useState<string | null>(null)
  // Messages whose open/folded state the reader changed by hand.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState(false)

  // This component is keyed by thread id, so state starts fresh for every conversation.
  useEffect(() => {
    let cancelled = false
    loadMessages({ id, historyId }).then(
      (loaded) => {
        if (cancelled) return
        setMessages(loaded)
        setError(null)
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      cancelled = true
    }
  }, [id, historyId, openRevision])

  const letters = messages?.filter((message) => !message.isDraft) ?? []
  const last = letters.at(-1)
  const ids = [id]
  const inTrash = thread.labelIds.includes('TRASH')
  const inSpam = thread.labelIds.includes('SPAM')
  const inInbox = thread.labelIds.includes('INBOX')
  const tapes = labels.filter((label) => thread.labelIds.includes(label.id))

  const mine = (message: Message) => sameEmail(message.from.email, me.email)
  const lastMine = letters.findLast(mine)
  const other = letters.findLast((message) => !mine(message))?.from
  // What Doar's server is keeping time for in this conversation.
  const held = reminders.find((reminder) => reminder.threadId === id && reminder.kind === 'hold' && reminder.status !== 'returned')
  const awaited = reminders.find((reminder) => reminder.threadId === id && reminder.kind === 'reply' && reminder.status !== 'returned')
  const cameBack = reminders.find((reminder) => reminder.threadId === id && reminder.status === 'returned')
  const express = !!other && marks.some((mark) => mark.mark === 'express' && matches(mark.match, other.email.toLowerCase()))

  // Like Gmail: the latest message and anything unread start open, older ones folded.
  const startsOpen = (message: Message) => message.id === last?.id || message.labelIds.includes('UNREAD')
  const isOpen = (message: Message) => letters.length === 1 || startsOpen(message) !== flipped.has(message.id)

  const flip = (messageId: string) =>
    setFlipped((current) => {
      const next = new Set(current)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })

  const recipients = (message: Message) => {
    const names = [...message.to, ...message.cc].map((contact) => (sameEmail(contact.email, me.email) ? 'אני' : shortName(contact)))
    return names.length > 3 ? `${names.slice(0, 3).join(', ')} ועוד ${names.length - 3}` : names.join(', ')
  }

  const pick = (action: () => void) => () => {
    setMenu(false)
    action()
  }

  return (
    <article className="thread">
      <header className="reader-bar">
        <button className="icon-btn back" onClick={onBack} aria-label="חזרה לרשימה">
          <BackIcon />
        </button>
        <span className="spacer" />
        {!inTrash && !inSpam && (
          <button
            className="icon-btn"
            aria-label={thread.starred ? 'הסרת כוכב' : 'סימון בכוכב'}
            title={thread.starred ? 'הסרת כוכב' : 'סימון בכוכב'}
            aria-pressed={thread.starred}
            onClick={() => mailbox.toggleStar(id)}
          >
            <StarIcon filled={thread.starred} />
          </button>
        )}
        {inInbox && (
          <button className="icon-btn" aria-label="להחזיר אליי במועד אחר" title="להחזיר אליי במועד אחר (b)" onClick={() => onHold()}>
            <HoldIcon />
          </button>
        )}
        {!inTrash && (
          <button className="icon-btn" aria-label="מחיקה" title="מחיקה" onClick={() => mailbox.trash(ids)}>
            <TrashIcon />
          </button>
        )}
        <div className="menu-anchor">
          <button className="icon-btn" aria-label="עוד פעולות" title="עוד פעולות" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>
            <MoreIcon />
          </button>
          {menu && (
            <>
              <button className="menu-backdrop" aria-label="סגירה" onClick={() => setMenu(false)} />
              <div className="menu" role="menu">
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={pick(() => {
                    mailbox.setRead(ids, false, { announce: true })
                    onBack()
                  })}
                >
                  <MailIcon />
                  סימון כלא נקרא
                </button>
                <button role="menuitem" className="menu-item" onClick={pick(onLabels)}>
                  <TagIcon />
                  תוויות
                </button>
                {lastMine && !awaited && !inTrash && (
                  <button role="menuitem" className="menu-item" onClick={pick(() => onRegister(lastMine.id))}>
                    <RegisteredIcon />
                    לרשום: להזכיר אם לא יענו
                  </button>
                )}
                {other && !inTrash && !inSpam && (
                  <button
                    role="menuitem"
                    className="menu-item"
                    onClick={pick(() =>
                      void mailbox.setMark(other.email, 'express', !express).then((saved) => {
                        if (saved) toast(express ? 'האקספרס הוסר.' : `מעכשיו מכתב מ־${shortName(other)} יתריע תמיד, גם מחוץ לשעות הפתיחה.`)
                      }),
                    )}
                  >
                    <ExpressIcon />
                    {express ? 'להסיר אקספרס מהשולח' : 'אקספרס: להתריע תמיד על השולח'}
                  </button>
                )}
                {!inSpam && !inTrash && (
                  <button role="menuitem" className="menu-item" onClick={pick(() => mailbox.spam(ids))}>
                    <SpamIcon />
                    דיווח כספאם
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {inTrash ? (
          <button className="pill-btn" onClick={() => mailbox.untrash(ids)}>
            <RestoreIcon />
            שחזור
          </button>
        ) : inSpam ? (
          <button className="pill-btn" onClick={() => mailbox.notSpam(ids)}>
            <InboxIcon />
            לא ספאם
          </button>
        ) : inInbox ? (
          <button className="pill-btn" onClick={() => mailbox.archive(ids)}>
            <ArchiveIcon />
            לתיוק
          </button>
        ) : (
          <button className="pill-btn" onClick={() => mailbox.moveToInbox(ids)}>
            <InboxIcon />
            לדואר הנכנס
          </button>
        )}
      </header>

      <h2 className="thread-subject" dir="auto">
        {thread.subject}
      </h2>
      {tapes.length > 0 && (
        <div className="thread-tapes">
          {tapes.map((label) => (
            <LabelTape key={label.id} label={label} />
          ))}
        </div>
      )}

      {held && (
        <div className="thread-slip">
          <HoldIcon />
          <span>שמור עד {formatWhen(held.dueAt)}</span>
          <button onClick={() => onHold(held.dueAt)}>שינוי</button>
          <button onClick={() => void mailbox.bringBack(id)}>להחזיר עכשיו</button>
        </div>
      )}
      {awaited && (
        <div className="thread-slip">
          <span className="reg-mark" aria-hidden="true">
            R
          </span>
          <span>רשום. אם לא יענו עד {formatDay(awaited.dueAt)}, המכתב יחזור אליך.</span>
          <button onClick={() => void mailbox.unregister(id)}>ביטול הרישום</button>
        </div>
      )}
      {cameBack && (
        <div className="thread-slip" data-returned>
          {cameBack.kind === 'reply' ? (
            <span className="reg-mark" aria-hidden="true">
              R
            </span>
          ) : (
            <HoldIcon />
          )}
          <span>{cameBack.kind === 'reply' ? `עדיין אין תשובה${cameBack.days ? `, אחרי ${countDays(cameBack.days)}` : ''}` : 'חזר מהדואר השמור'}</span>
          {cameBack.kind === 'reply' && lastMine && <button onClick={() => mailbox.reply(lastMine, 'reply')}>לכתוב תזכורת</button>}
          {cameBack.kind === 'reply' && lastMine && <button onClick={() => onRegister(lastMine.id)}>להזכיר שוב</button>}
          {cameBack.kind === 'reply' && <button onClick={() => void mailbox.unregister(id)}>לוותר</button>}
        </div>
      )}

      {error && <p className="error">לא הצלחנו לפתוח את המכתב. {error}</p>}
      {!messages && !error && <p className="muted thread-wait">פותחים את המעטפה…</p>}

      {messages?.map((message) => {
        if (message.isDraft) {
          return (
            <section key={message.id} className="message">
              <div className="draft-slip">
                <span className="draft-mark">טיוטה</span>
                <span className="draft-text ellipsis" dir="auto">
                  {message.snippet || 'מכתב שעוד לא נשלח'}
                </span>
                <button onClick={() => void mailbox.editDraft(message)}>להמשיך לכתוב</button>
              </div>
            </section>
          )
        }
        if (!isOpen(message)) {
          return (
            <section key={message.id} className="message">
              <button className="folded" onClick={() => flip(message.id)} aria-expanded={false}>
                <span className="folded-who">
                  {shortName(message.from)} · {formatListDate(message.date)}
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
            <div className="envelope">
              {/* The whole envelope folds the letter away; the name and address on it are buttons of their own, above this one. */}
              <button
                type="button"
                className="envelope-toggle"
                onClick={() => letters.length > 1 && flip(message.id)}
                aria-expanded={true}
                aria-label={`מאת ${message.from.name}, ${formatFullDate(message.date)}`}
              />
              <span className="envelope-label">מאת</span>
              {message.from.name && <Copyable className="envelope-name" dir="auto" text={message.from.name} done="השם הועתק" />}
              {message.from.email && <Copyable className="envelope-addr" dir="ltr" text={message.from.email} done="הכתובת הועתקה" hint />}
              {message.to.length + message.cc.length > 0 && (
                <span className="envelope-addr envelope-to ellipsis" dir="auto">
                  אל: {recipients(message)}
                </span>
              )}
              <span className="envelope-date">{formatLetterDate(message.date)}</span>
              <span className="envelope-stamp">
                <SenderStamp contact={message.from} size="lg" />
                <DuplexCancel iso={message.date} />
              </span>
              {message.id === last?.id && thread.starred && <GoldStar className="envelope-star" />}
            </div>
            <div className="letter">
              <EmailBody message={message} />
              <Attachments files={realAttachments(message)} />
            </div>
          </section>
        )
      })}

      {last?.unsubscribe && !inTrash && (
        <button className="link-btn unsubscribe" onClick={() => void unsubscribe(last, me)}>
          הסרה מרשימת התפוצה
        </button>
      )}

      {last && !inTrash && (
        <div className="reply-bar">
          <button className="ticket ticket-main" onClick={() => mailbox.reply(last, 'reply')}>
            <ReplyIcon />
            השב
          </button>
          {last.to.length + last.cc.length > 1 && (
            <button className="ticket" onClick={() => mailbox.reply(last, 'replyAll')}>
              <ReplyAllIcon />
              השב לכולם
            </button>
          )}
          <button className="ticket" onClick={() => mailbox.reply(last, 'forward')}>
            <ForwardIcon />
            העבר
          </button>
        </div>
      )}
    </article>
  )
}
