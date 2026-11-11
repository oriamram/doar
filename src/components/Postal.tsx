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

/** Wavy cancellation lines struck across a stamp once its letter has been read. */
function CancelWaves() {
  const wave = (y: number) => `M1 ${y} q 4 -5 8 0 t 8 0 t 8 0 t 8 0 t 8 0 t 8 0 t 8 0 t 8 0`
  return (
    <svg className="cancel-waves" width="66" height="34" viewBox="0 0 66 34" aria-hidden="true">
      <path d={wave(7)} />
      <path d={wave(17)} />
      <path d={wave(27)} />
    </svg>
  )
}

type StampProps = {
  contact: Contact
  /** Read mail: the stamp is faded and struck through with cancellation waves. */
  cancelled?: boolean
  seed: string
  size?: 'sm' | 'lg'
}

/** The sender's own postage stamp: their color and initial, with perforated edges. */
export function SenderStamp({ contact, cancelled, seed, size = 'sm' }: StampProps) {
  const style = { '--stamp': stampColor(contact), transform: `rotate(${tilt(seed, 3)}deg)` } as CSSProperties
  return (
    <span className="sender-stamp" data-size={size} data-cancelled={cancelled || undefined} style={style} aria-hidden="true">
      <span className="stamp-face">
        <span className="stamp-letter">{stampLetter(contact.name)}</span>
        <span className="stamp-word">דואר</span>
      </span>
      {cancelled && size === 'sm' && <CancelWaves />}
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

/** Perforated stamp showing a number (the unread count). */
export function CountStamp({ count, label }: { count: number; label: string }) {
  return (
    <span className="count-stamp" aria-label={`${count} ${label}`}>
      <span className="stamp-face">
        <strong aria-hidden="true">{count}</strong>
        <span aria-hidden="true">{label}</span>
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
