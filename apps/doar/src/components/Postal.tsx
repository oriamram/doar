import type { CSSProperties } from 'react'
import { formatDay, formatFullDate, formatWhen, postmark } from '../lib/format'
import type { Reminder } from '../lib/postman'
import { hash, stampColor, stampLetter } from '../lib/stamps'
import { labelLeaf } from '../lib/views'
import type { Contact, Label } from '../types'
import { HoldIcon } from './icons'

type StampProps = {
  contact: Contact
  /** sm: in lists. lg: on an opened envelope. */
  size?: 'sm' | 'lg'
  /** Read mail: the stamp has done its job and fades a little. */
  used?: boolean
}

/**
 * The sender's postage stamp: their initial struck on a coin, in their color,
 * on stamp paper with real perforations (the holes are cut out, so whatever
 * it's stuck on shows through).
 */
export function SenderStamp({ contact, size = 'sm', used }: StampProps) {
  return (
    <span
      className="stamp"
      data-size={size}
      data-used={used || undefined}
      style={{ '--stamp': stampColor(contact) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="stamp-paper">
        <span className="stamp-face">
          <span className="stamp-coin">{stampLetter(contact.name || contact.email)}</span>
        </span>
      </span>
    </span>
  )
}

/** A gold foil star sticker, for starred mail. */
export function GoldStar({ className = '' }: { className?: string }) {
  return <span className={`gold-star ${className}`} aria-hidden="true" />
}

/** A steel paperclip on the edge of an envelope that carries files. */
export function Paperclip() {
  return (
    <svg className="paperclip" width="11" height="26" viewBox="0 0 11 26" aria-hidden="true">
      <path d="M8.6 6.5v12a3.05 3.05 0 0 1-6.1 0V5.4a2 2 0 0 1 4 0V17a.95.95 0 0 1-1.9 0V7.2" />
    </svg>
  )
}

/** The bow where a bundle's twine is tied. */
export function TwineBow() {
  return (
    <svg className="twine-bow" width="36" height="28" viewBox="0 0 36 28" aria-hidden="true">
      <path d="M18 13C12 2 2 3 3 9.5S12 16 18 13" />
      <path d="M18 13c6-11 16-10 15-3.5S24 16 18 13" />
      <path d="M18 13l-7 12M18 13l8 12" />
      <circle cx="18" cy="13" r="2.7" />
    </svg>
  )
}

const TAPES = ['#26262b', '#9b231c', '#1f4f9a', '#1f6b4a', '#6e4a2e']

/** How bright a "#rrggbb" color is, from 0 (black) to 1 (white). */
function brightness(hex: string): number {
  const value = parseInt(hex.slice(1), 16)
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
}

/** A label's tape: its Gmail color, or a classic tape color when it has none; with ink that reads on it. */
function tapeStyle(label: Label): CSSProperties {
  const tape = label.color && /^#[0-9a-f]{6}$/i.test(label.color) ? label.color : TAPES[hash(label.id) % TAPES.length]!
  return { '--tape': tape, '--tape-ink': brightness(tape) > 0.4 ? '#1f2a3a' : '#fffdf6' } as CSSProperties
}

/**
 * The slip on a letter that Doar's server is keeping time for: when a held letter
 * comes back, how long a registered letter waits for its answer, or that it came back.
 */
export function ReminderSlip({ reminder }: { reminder: Reminder }) {
  const back = reminder.status === 'returned'
  const text =
    reminder.kind === 'hold'
      ? back
        ? 'חזר מהדואר השמור'
        : `חוזר ${formatWhen(reminder.dueAt)}`
      : back
        ? 'עדיין אין תשובה'
        : `ממתין לתשובה עד ${formatDay(reminder.dueAt)}`
  return (
    <span className="row-slip" data-returned={back || undefined}>
      {reminder.kind === 'reply' ? (
        <span className="reg-mark" aria-hidden="true">
          R
        </span>
      ) : (
        <HoldIcon />
      )}
      {text}
    </span>
  )
}

/** One of your labels, as a strip of embossing-machine tape. */
export function LabelTape({ label }: { label: Label }) {
  return (
    <span className="tape" style={tapeStyle(label)} title={label.name}>
      {labelLeaf(label.name)}
    </span>
  )
}

/** A short blank piece of a label's tape, to mark it in the folder list. */
export function TapeSwatch({ label }: { label: Label }) {
  return <span className="tape tape-swatch" style={tapeStyle(label)} aria-hidden="true" />
}

/**
 * Duplex cancel, as struck at the post office: heavy bars over the stamp and a
 * dated ring beside it, on the envelope paper where the date stays readable.
 */
export function DuplexCancel({ iso }: { iso: string }) {
  const { top, bottom } = postmark(iso)
  return (
    <span className="duplex" role="img" aria-label={formatFullDate(iso)} dir="ltr">
      <span className="duplex-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className="duplex-ring" aria-hidden="true">
        <span className="pm-small">DOAR</span>
        <span className="pm-top">{top}</span>
        <span className="pm-small">{bottom}</span>
      </span>
    </span>
  )
}

/** The logo: a sealed airmail envelope, lying on the desk like the rest of the mail. `width` is in CSS pixels. */
export function Logo({ width, className }: { width: number; className?: string }) {
  return (
    <img
      className={className ? `logo ${className}` : 'logo'}
      // Two sizes of the same photo (see scripts/make-icons.py): the small one is plenty for the menu.
      src={width <= 56 ? '/logo-envelope-small.webp' : '/logo-envelope.webp'}
      width={width}
      height={Math.round((width * 577) / 720)}
      alt=""
      draggable={false}
    />
  )
}
