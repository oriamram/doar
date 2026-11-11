import type { CSSProperties } from 'react'
import { formatFullDate, postmark, tilt } from '../lib/format'
import type { Contact } from '../types'

/** Stamp colors, after the old practice of printing each stamp value in its own color. */
const STAMP_COLORS = ['#1f5f5b', '#24407a', '#6e4a2e', '#5e3f7a', '#5b6b2e', '#a86a12']

function hash(text: string): number {
  let h = 0
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) | 0
  return Math.abs(h)
}

/** Each sender always gets the same stamp color. */
function stampColor(contact: Contact): string {
  return STAMP_COLORS[hash((contact.email || contact.name).toLowerCase()) % STAMP_COLORS.length]!
}

/** First letter or digit of a name ("“Maya” Levi" → "M", "מאיה" → "מ"). */
function stampLetter(name: string): string {
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '·').toUpperCase()
}

/**
 * The sender in the inbox list: a small upright stamp in their color with their
 * initial. Once read, it's cancelled with an X, like a used stamp.
 */
export function SenderAvatar({ contact, read }: { contact: Contact; read?: boolean }) {
  return (
    <span
      className="mini-stamp"
      data-read={read || undefined}
      style={{ '--stamp': stampColor(contact) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="mini-face">{stampLetter(contact.name)}</span>
      {read && (
        <svg className="mini-cancel" viewBox="0 0 40 46" preserveAspectRatio="none">
          <path d="M7 7L33 39M33 7L7 39" />
        </svg>
      )}
    </span>
  )
}

/** The sender's postage stamp on an opened envelope: their color and initial, perforated. */
export function SenderStamp({ contact, seed }: { contact: Contact; seed: string }) {
  const style = { '--stamp': stampColor(contact), transform: `rotate(${tilt(seed, 3)}deg)` } as CSSProperties
  return (
    <span className="sender-stamp" style={style} aria-hidden="true">
      <span className="stamp-face">
        <span className="stamp-letter">{stampLetter(contact.name)}</span>
        <span className="stamp-word">דואר</span>
      </span>
    </span>
  )
}

/** Duplex cancel: a dated ring beside heavy bars, as stamped on a letter at the post office. */
export function DuplexCancel({ iso }: { iso: string }) {
  const { top, bottom } = postmark(iso)
  return (
    <span className="duplex" role="img" aria-label={formatFullDate(iso)} dir="ltr">
      <span className="duplex-ring" aria-hidden="true">
        <span className="pm-small">DOAR</span>
        <span className="pm-top">{top}</span>
        <span className="pm-small">{bottom}</span>
      </span>
      <span className="duplex-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}

/** The Doar envelope mark, drawn in the current accent color. */
export function DoarMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="var(--accent)" />
      <rect x="112" y="168" width="288" height="192" rx="28" fill="none" stroke="var(--on-accent)" strokeWidth="28" />
      <path
        d="M132 192l124 88 124-88"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
