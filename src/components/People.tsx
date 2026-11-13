import { useEffect, useMemo, useState } from 'react'
import { matches } from '../../supabase/functions/postman/rules.ts'
import { shortName } from '../lib/addresses'
import { copyText } from '../lib/clipboard'
import { newDraft } from '../lib/compose'
import { topContacts } from '../lib/contacts'
import { lettersFrom } from '../lib/gmail'
import { mailbox, useMailbox } from '../lib/mailbox'
import { toast } from '../lib/toast'
import type { Contact } from '../types'
import { ClipIcon, CopyIcon, ExpressIcon, HandIcon, NibIcon, SearchIcon, TagIcon } from './icons'
import { SenderStamp } from './Postal'
import { Sheet } from './Sheets'

async function copy(text: string, done: string) {
  if (await copyText(text)) toast(done)
  else toast('ההעתקה לא הצליחה במכשיר הזה.', { tone: 'error' })
}

type CardProps = {
  contact: Contact
  onClose: () => void
  /** Open the automatic-labels form, filled in for this sender. */
  onRules: (from: string) => void
}

/** A sender's card: who they are, their mail, and what can be decided about them. */
export function SenderCard({ contact, onClose, onRules }: CardProps) {
  const { marks, me } = useMailbox()
  const address = contact.email.toLowerCase()
  const has = (mark: 'express' | 'refused') => marks.some((item) => item.mark === mark && matches(item.match, address))
  const express = has('express')
  const refused = has('refused')
  const [count, setCount] = useState<number | null>(null)
  const mine = address === me.email.toLowerCase()
  // Refusing a sender bins their mail from now on, so it takes two presses: one to ask, one to mean it.
  const [sure, setSure] = useState(false)
  const refuse = () => {
    if (refused) return void mailbox.setMark(address, 'refused', false)
    if (!sure) return setSure(true)
    setSure(false)
    void mailbox.setMark(address, 'refused', true).then((saved) => {
      if (saved) toast(`מעכשיו מכתבים מ־${shortName(contact)} ילכו ישר לאשפה.`, { action: { label: 'ביטול', run: () => void mailbox.setMark(address, 'refused', false) } })
    })
  }

  useEffect(() => {
    let cancelled = false
    lettersFrom(address, 100).then(
      (found) => !cancelled && setCount(found),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [address])

  const go = (query: string) => {
    mailbox.show({ kind: 'search', query })
    onClose()
  }

  return (
    <Sheet title="כרטיס שולח" form="טופס 17 · פרטי מען" onClose={onClose}>
      <div className="person-head">
        <SenderStamp contact={contact} size="lg" />
        <div className="person-who">
          {contact.name && contact.name !== contact.email && (
            <button type="button" className="person-name" onClick={() => void copy(contact.name, 'השם הועתק')} title="לחיצה מעתיקה" dir="auto">
              {contact.name}
            </button>
          )}
          <button type="button" className="person-addr" onClick={() => void copy(contact.email, 'הכתובת הועתקה')} title="לחיצה מעתיקה">
            <span dir="ltr">{contact.email}</span>
            <CopyIcon />
          </button>
          {count !== null && !mine && (
            <span className="person-count">
              {count === 0 ? 'עוד אין מכתבים מהכתובת הזאת' : count >= 100 ? 'יותר מ־100 מכתבים מהכתובת הזאת' : count === 1 ? 'מכתב אחד מהכתובת הזאת' : `${count} מכתבים מהכתובת הזאת`}
            </span>
          )}
        </div>
      </div>

      <div className="person-actions">
        <button
          type="button"
          className="person-action"
          onClick={() => {
            mailbox.compose(newDraft([contact]))
            onClose()
          }}
        >
          <NibIcon />
          לכתוב מכתב
        </button>
        <button type="button" className="person-action" onClick={() => go(`from:${address} OR to:${address}`)}>
          <SearchIcon />
          כל המכתבים
        </button>
        <button type="button" className="person-action" onClick={() => go(`from:${address} has:attachment`)}>
          <ClipIcon />
          הקבצים שהגיעו
        </button>
        {!mine && (
          <button type="button" className="person-action" onClick={() => onRules(address)}>
            <TagIcon />
            תווית אוטומטית
          </button>
        )}
      </div>

      {!mine && (
        <div className="person-marks">
          <button type="button" className="person-mark" aria-pressed={express} onClick={() => void mailbox.setMark(address, 'express', !express)}>
            <ExpressIcon />
            <span>
              <strong>אקספרס</strong>
              <span>להתריע על כל מכתב מהכתובת הזאת, גם מחוץ לשעות הפתיחה.</span>
            </span>
          </button>
          <button type="button" className="person-mark" data-tone="red" data-asking={sure || undefined} aria-pressed={refused} onClick={refuse} onBlur={() => setSure(false)}>
            <HandIcon />
            <span>
              <strong>{sure ? 'בטוח? לחיצה נוספת תאשר' : 'החזר לשולח'}</strong>
              <span>כל מכתב מהכתובת הזאת ילך ישר לאשפה, בלי התראה. Gmail שומר אותו שם 30 יום.</span>
            </span>
          </button>
        </div>
      )}
    </Sheet>
  )
}

/** The stamp album: the people you exchange mail with, as stamps on an album page. It is the address book. */
export function StampAlbum({ onClose, onPerson }: { onClose: () => void; onPerson: (contact: Contact) => void }) {
  const people = useMemo(() => topContacts(90), [])
  const [typed, setTyped] = useState('')
  const query = typed.trim().toLowerCase()
  const shown = query ? people.filter((person) => person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query)) : people
  return (
    <Sheet title="אלבום הבולים" form="נספח ג׳ · אנשים וכתובות" onClose={onClose}>
      {people.length > 8 && (
        <input className="text-input album-search" type="search" placeholder="חיפוש באלבום" aria-label="חיפוש באלבום" value={typed} onChange={(e) => setTyped(e.target.value)} />
      )}
      {shown.length === 0 ? (
        <p className="muted">{people.length === 0 ? 'האלבום עוד ריק. הוא מתמלא מעצמו באנשים שכותבים אליכם ושאתם כותבים אליהם.' : 'אין באלבום מישהו כזה.'}</p>
      ) : (
        <ul className="album">
          {shown.map((person) => (
            <li key={person.email}>
              <button type="button" className="album-stamp" onClick={() => onPerson(person)} title={person.email}>
                <SenderStamp contact={person} size="lg" />
                <span className="album-name ellipsis" dir="auto">
                  {shortName(person)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
