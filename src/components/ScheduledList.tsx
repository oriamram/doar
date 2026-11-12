import { useState } from 'react'
import { shortName } from '../lib/addresses'
import { formatWhen } from '../lib/format'
import { mailbox, useMailbox, type Scheduled } from '../lib/mailbox'
import { ClockIcon } from './icons'
import { ScheduleSheet } from './Sheets'

const REASONS: Record<string, string> = {
  reauth: 'צריך להתחבר מחדש',
  draft_missing: 'הטיוטה נמחקה',
  unknown_outcome: 'לא ברור אם נשלח; כדאי לבדוק ב„נשלחו”',
  gmail_unavailable: 'Gmail לא היה זמין',
}

function whenText(item: Scheduled): string {
  if (item.status === 'failed') return `לא נשלח: ${REASONS[item.error ?? ''] ?? 'Gmail סירב לשלוח'}`
  if (item.status === 'sending') return 'יוצא עכשיו…'
  return `יישלח ${formatWhen(item.sendAt)}`
}

/** Letters waiting for their time. Each can be opened, moved to another time, or taken off the schedule. */
export function ScheduledList() {
  const { scheduled } = useMailbox()
  const [moving, setMoving] = useState<Scheduled | null>(null)

  return (
    <>
      {scheduled.map((item) => {
        const failed = item.status === 'failed'
        const names = (item.to ?? []).map(shortName).join(', ')
        return (
          <li key={item.id}>
            <div className="scheduled-row" data-failed={failed || undefined}>
              <button type="button" className="scheduled-open" onClick={() => void mailbox.openScheduled(item.id)}>
                <span className="scheduled-to ellipsis">{item.to ? names || 'עוד בלי נמען' : '…'}</span>
                <span className="scheduled-subject ellipsis">{item.to ? item.subject || '(בלי נושא)' : ''}</span>
                <span className="scheduled-when">
                  <ClockIcon />
                  {whenText(item)}
                </span>
              </button>
              <span className="scheduled-actions">
                <button type="button" onClick={() => setMoving(item)} disabled={item.status === 'sending'}>
                  {failed ? 'מועד חדש' : 'שינוי מועד'}
                </button>
                <button type="button" onClick={() => void mailbox.unschedule(item.id)} disabled={item.status === 'sending'}>
                  {failed ? 'הסרה' : 'ביטול'}
                </button>
              </span>
            </div>
          </li>
        )
      })}
      {moving && (
        <ScheduleSheet
          current={moving.status === 'failed' ? undefined : moving.sendAt}
          onPick={(when) => {
            void mailbox.reschedule(moving.id, when)
            setMoving(null)
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </>
  )
}
