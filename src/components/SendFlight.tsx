import { useEffect } from 'react'
import { mailbox } from '../lib/mailbox'
import { tapHaptic } from '../lib/platform'
import { playSound } from '../lib/sound'

/**
 * The moment a letter is sent: it's sealed in an airmail envelope, the stamp
 * comes down, and it flies off. Purely for show; sending happens elsewhere.
 */
export function SendFlight({ to }: { to: string }) {
  useEffect(() => {
    playSound('paper')
    const stamp = setTimeout(() => {
      playSound('thump')
      tapHaptic()
    }, 340)
    const away = setTimeout(() => playSound('whoosh'), 720)
    const done = setTimeout(mailbox.endFlight, 1300)
    return () => {
      clearTimeout(stamp)
      clearTimeout(away)
      clearTimeout(done)
    }
  }, [])

  return (
    <div className="flight" aria-hidden="true">
      <div className="flight-envelope">
        <span className="flight-label">PAR AVION · בדואר אוויר</span>
        <span className="flight-to">
          <span>אל</span>
          <strong dir="auto">{to || '…'}</strong>
        </span>
        <span className="stamp flight-stamp" data-size="lg">
          <span className="stamp-paper">
            <span className="stamp-face">
              <span className="stamp-coin">ד</span>
            </span>
          </span>
        </span>
      </div>
    </div>
  )
}
