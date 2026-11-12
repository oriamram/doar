type Props = {
  label?: string
  /** A smaller version, for inside a list instead of the whole screen. */
  compact?: boolean
}

/** A letter slipping in and out of its envelope while mail is being fetched. */
export function Loader({ label = 'ממיינים את הדואר…', compact }: Props) {
  return (
    <div className="loader" data-compact={compact || undefined} role="status" aria-live="polite">
      <svg className="loader-envelope" width="132" height="112" viewBox="0 0 132 112" aria-hidden="true">
        {/* Back of the envelope and its open flap */}
        <path className="env-flap" d="M10 46 L66 8 L122 46 Z" />
        <rect className="env-back" x="10" y="46" width="112" height="60" rx="4" />
        {/* The letter */}
        <g className="loader-letter">
          <rect className="letter-sheet" x="22" y="30" width="88" height="62" rx="2" />
          <rect className="letter-stamp" x="88" y="36" width="15" height="18" rx="1" />
          <path className="letter-lines" d="M30 42h46M30 52h52M30 62h40M30 72h48" />
        </g>
        {/* Front pocket, drawn over the letter so it looks tucked inside */}
        <path className="env-front" d="M10 50 L66 82 L122 50 V102 a4 4 0 0 1 -4 4 H14 a4 4 0 0 1 -4 -4 Z" />
      </svg>
      <span className="loader-label">{label}</span>
      {!compact && (
        <span className="loader-track" aria-hidden="true">
          <span className="airmail-band" />
        </span>
      )}
    </div>
  )
}
