import type { CSSProperties, ReactNode } from 'react'
import type { Contact } from '../types'
import { BellIcon, ClockIcon, CopyIcon, HandIcon, HoldIcon, ParcelIcon, SendIcon } from './icons'
import { SenderStamp, TwineBow } from './Postal'

// The guide's pictures. Each is the real object from the app, small: the same paper, the
// same stamp, the same seal, drawn with the same colors, so that whoever saw it here knows
// it when it turns up in the mail. They are pictures only: nothing in them can be pressed.

const who = (name: string, email: string): Contact => ({ name, email })
const DANA = who('דנה', 'dana@levi.example')
const NOA = who('נועה', 'noa.barak@friends.example')
const AVI = who('אבי', 'avi.peretz@work.example')
const ELECTRIC = who('חברת החשמל', 'bills@hashmal-dugma.example')

const tape = (color: string) => ({ '--tape': color, '--tape-ink': '#fffdf6' }) as CSSProperties

/** A few lines of writing, too small to read. */
const Lines = () => <span className="a-lines" />

const ART: Record<string, () => ReactNode> = {
  notify: () => (
    <span className="a-notify">
      <span className="a-notify-top">
        <BellIcon />
        <b>דנה לוי</b>
      </span>
      <span className="a-notify-btns">
        <i>לתיוק</i>
        <i>נקרא</i>
      </span>
    </span>
  ),
  widget: () => (
    <span className="a-widget">
      <span className="a-widget-edge" />
      <b>דואר</b>
      <span className="a-widget-row" data-new>
        <i />
        נועה
      </span>
      <span className="a-widget-row" data-new>
        <i />
        חברת החשמל
      </span>
      <span className="a-widget-row">
        <i />
        אבי
      </span>
    </span>
  ),
  ticket: () => (
    <span className="a-ticket">
      <span className="a-stub">
        <CopyIcon />
      </span>
      <span className="a-digits">482 913</span>
    </span>
  ),
  parcel: () => (
    <span className="a-parcel">
      <ParcelIcon />
      <span>
        <b>בדרך</b>
        <i>RR 4821</i>
      </span>
    </span>
  ),
  receipt: () => (
    <span className="a-receipt">
      <Lines />
      <span className="a-sum">128.00 ₪</span>
    </span>
  ),
  invite: () => (
    <span className="a-invite">
      <span className="invite-date">
        <span className="invite-month">נוב׳</span>
        <span className="invite-day">12</span>
        <span className="invite-weekday">יום ה׳</span>
      </span>
    </span>
  ),
  bundle: () => (
    <span className="a-bundle">
      <span className="a-bundle-top">
        <Lines />
      </span>
      <span className="twine a-twine-across" />
      <span className="twine a-twine-down" />
      <TwineBow />
    </span>
  ),
  ritual: () => (
    <span className="a-postman">
      <b>
        הדוור הביא
        <br />5 מכתבים
      </b>
      <span className="twine a-postman-twine" />
      <TwineBow />
    </span>
  ),
  swipe: () => (
    <span className="a-swipe">
      <span className="a-rubber">לתיוק</span>
      <span className="a-env">
        <Lines />
      </span>
    </span>
  ),
  hold: () => (
    <span className="a-timed">
      <HoldIcon />
      <span className="a-slip">חוזר מחר 08:00</span>
    </span>
  ),
  note: () => (
    <span className="a-note">
      <svg className="a-clip" width="9" height="21" viewBox="0 0 11 26">
        <path d="M8.6 6.5v12a3.05 3.05 0 0 1-6.1 0V5.4a2 2 0 0 1 4 0V17a.95.95 0 0 1-1.9 0V7.2" />
      </svg>
      להתקשר
      <br />
      ביום שלישי
    </span>
  ),
  seal: () => (
    <span className="a-sealed">
      <i>dana@levi.test</i>
      <span>
        <span className="seal" />
        השולח אומת
      </span>
    </span>
  ),
  warning: () => (
    <span className="a-warn">
      <span className="seal a-broken" />
      <b>
        כדאי לחשוד
        <br />
        במכתב הזה
      </b>
    </span>
  ),
  card: () => (
    <span className="a-card">
      <SenderStamp contact={DANA} />
      <Lines />
    </span>
  ),
  send: () => (
    <span className="a-send">
      <span className="stamp" style={{ '--stamp': 'var(--ink-red)' } as CSSProperties}>
        <span className="stamp-paper">
          <span className="stamp-face">
            <SendIcon />
          </span>
        </span>
      </span>
      <b>שליחה</b>
    </span>
  ),
  registered: () => (
    <span className="a-reg">
      <span className="a-reg-r">R</span>
      <span>
        <b>רשום</b>
        <i>RR 4821</i>
      </span>
    </span>
  ),
  later: () => (
    <span className="a-timed">
      <ClockIcon />
      <span className="a-slip">יישלח מחר 08:00</span>
    </span>
  ),
  undo: () => (
    <span className="a-undo">
      <span>המכתב נשלח</span>
      <b>ביטול</b>
      <span className="a-timer" />
    </span>
  ),
  hours: () => (
    <span className="a-sign">
      <b>פתוח</b>
      <i>07:00–22:00</i>
    </span>
  ),
  express: () => (
    <span className="a-express">
      <BellIcon />
      <span className="a-express-env">
        <b>אמא</b>
        <span className="express-mark">אקספרס</span>
      </span>
    </span>
  ),
  return: () => (
    <span className="a-letter">
      <Lines />
      <span className="a-returned">
        <HandIcon />
        <span>
          הוחזר
          <br />
          לשולח
        </span>
      </span>
    </span>
  ),
  chips: () => (
    <span className="a-chips">
      <i data-on="">עם קובץ</i>
      <i>מהשבוע</i>
      <i>ממני</i>
      <i>לא נקראו</i>
    </span>
  ),
  album: () => (
    <span className="a-album a-mini">
      <SenderStamp contact={NOA} />
      <SenderStamp contact={AVI} />
      <SenderStamp contact={DANA} />
    </span>
  ),
  spike: () => (
    <span className="a-spike">
      <i />
      <i />
      <i />
      <span className="a-pin" />
      <span className="a-base" />
    </span>
  ),
  files: () => (
    <span className="a-file">
      <span className="file-kind">PDF</span>
      <Lines />
    </span>
  ),
  labels: () => (
    <span className="a-tapes">
      <span className="tape" style={tape('#1f4f9a')}>
        עבודה
      </span>
      <span className="tape" style={tape('#1f6b4a')}>
        משפחה
      </span>
      <span className="tape" style={tape('#26262b')}>
        חשבונות
      </span>
    </span>
  ),
  rules: () => (
    <span className="a-rule a-mini">
      <SenderStamp contact={ELECTRIC} />
      <svg className="a-arrow" width="18" height="10" viewBox="0 0 18 10">
        <path d="M17 5H2M6 1 2 5l4 4" />
      </svg>
      <span className="tape" style={tape('#1f6b4a')}>
        בית
      </span>
    </span>
  ),
  lamp: () => (
    <span className="a-lamp">
      <span className="chain-beads" />
      <span className="chain-pull" />
    </span>
  ),
  offline: () => (
    <span className="a-offline">
      <span className="a-page">
        <Lines />
      </span>
      <svg className="a-nowifi" viewBox="0 0 24 24">
        <path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.6a9.4 9.4 0 0 1 12.4 0M9.1 16.1a4.8 4.8 0 0 1 5.8 0M4 3l16 18" />
        <circle cx="12" cy="19.3" r="1.2" />
      </svg>
    </span>
  ),
  palette: () => (
    <span className="a-palette">
      <b>לאן?</b>
      <span className="a-typed">דוק</span>
      <span className="a-keys">
        <kbd>Ctrl</kbd>
        <kbd>K</kbd>
      </span>
    </span>
  ),
}

/** The picture beside an entry: the thing itself, lying on a piece of the desk. */
export function GuideArt({ id }: { id: string }) {
  return (
    <span className="guide-art" data-art={id} aria-hidden="true">
      {ART[id]?.()}
    </span>
  )
}
