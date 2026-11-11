import { formatFullDate, postmark, tilt } from '../lib/format'

/** Round postmark showing a date. */
export function Postmark({ iso, seed, faded }: { iso: string; seed: string; faded?: boolean }) {
  const { top, bottom } = postmark(iso)
  return (
    <span
      className="postmark"
      data-faded={faded || undefined}
      style={{ transform: `rotate(${tilt(seed)}deg)` }}
      role="img"
      aria-label={formatFullDate(iso)}
    >
      <span className="pm-top" aria-hidden="true">
        {top}
      </span>
      <span className="pm-bottom" aria-hidden="true">
        {bottom}
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
