import { useEffect, useMemo, useState } from 'react'
import { letterText, listThreads, loadMessages } from '../lib/gmail'
import { formatAmount, type Amount } from '../lib/kinds'
import { mailbox } from '../lib/mailbox'
import { shekelRates, type Rates } from '../lib/rates'
import { updateSettings, useSettings } from '../lib/settings'
import { addUp, gather, inShekels, readCharge, SUBSCRIPTION_SEARCH, type Charge, type Subscription } from '../lib/subscriptions'
import type { Thread } from '../types'
import { Loader } from './Loader'
import { SenderStamp } from './Postal'
import { Sheet } from './Sheets'

const PER: Record<string, string> = { week: 'לשבוע', month: 'לחודש', quarter: 'לרבעון', year: 'לשנה' }
const EVERY: Record<string, string> = { week: 'כל שבוע', month: 'כל חודש', quarter: 'כל שלושה חודשים', year: 'כל שנה' }

/** Sums in several currencies, the way the spike writes them: "₪39.90 ועוד $100.00". */
function Sums({ sums }: { sums: Amount[] }) {
  if (sums.length === 0) return <>—</>
  return (
    <>
      {sums.map((sum, index) => (
        <span key={sum.currency} className="subs-sum">
          {index > 0 && 'ועוד '}
          {formatAmount(sum)}
        </span>
      ))}
    </>
  )
}

const shekels = (value: number) => `${Math.round(value).toLocaleString('en-US')} ₪`
const day = (at: number) => new Date(at).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })

/**
 * The last twelve months as a strip of a punched pass: a hole for every month it charged.
 * Read like the rest of the page, right to left: the oldest month on the right.
 */
function Punches({ charges, now }: { charges: Charge[]; now: number }) {
  const today = new Date(now)
  const months = Array.from({ length: 12 }, (_, index) => {
    const start = new Date(today.getFullYear(), today.getMonth() - 11 + index, 1)
    const end = new Date(today.getFullYear(), today.getMonth() - 10 + index, 1)
    return {
      key: start.getTime(),
      name: start.toLocaleDateString('he-IL', { month: 'long' }),
      paid: charges.some((charge) => charge.at >= start.getTime() && charge.at < end.getTime()),
    }
  })
  const paid = months.filter((month) => month.paid).length
  return (
    <span className="subs-punches" role="img" aria-label={`חויב ב־${paid} מתוך 12 החודשים האחרונים`}>
      {months.map((month) => (
        <i key={month.key} data-paid={month.paid || undefined} title={month.name} />
      ))}
    </span>
  )
}

function Card({ item, now, threads, onOpen }: { item: Subscription; now: number; threads: Map<string, Thread>; onOpen: (thread: Thread) => void }) {
  const [open, setOpen] = useState(false)
  const { subscriptions: overrides } = useSettings()
  const drop = () =>
    updateSettings({ subscriptions: { add: overrides.add.filter((key) => key !== item.key), drop: [...new Set([...overrides.drop, item.key])] } })
  const sender = item.charges[0]!
  return (
    <li className="subs-card" data-ended={!item.active || undefined}>
      <button type="button" className="subs-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SenderStamp contact={{ name: item.name, email: `billing@${item.key.split('/')[0]}` }} />
        <span className="subs-what">
          <strong className="ellipsis" dir="auto">
            {item.name}
          </strong>
          {item.plan && item.plan !== item.name && (
            <span className="ellipsis" dir="auto">
              {item.plan}
            </span>
          )}
        </span>
        <span className="subs-price">
          {item.price ? formatAmount(item.price) : '—'}
          <small>{item.period ? PER[item.period] : 'תקופה לא ידועה'}</small>
        </span>
      </button>
      <Punches charges={item.charges} now={now} />
      <p className="subs-line">
        {item.active
          ? item.nextAt && item.nextAt > now
            ? `החיוב הבא בערך ב־${day(item.nextAt)}`
            : `חויב לאחרונה ב־${day(item.lastAt)}`
          : `נראה שהסתיים: הקבלה האחרונה מ־${day(item.lastAt)}`}
        {item.year.length > 0 && (
          <>
            {' · בשנה: '}
            <Sums sums={item.year} />
          </>
        )}
      </p>
      {open && (
        <div className="subs-receipts">
          <ul>
            {item.charges.map((charge) => {
              const thread = threads.get(charge.thread)
              return (
                <li key={`${charge.thread}-${charge.at}`}>
                  <button type="button" disabled={!thread} onClick={() => thread && onOpen(thread)}>
                    <span>{new Date(charge.at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <span className="subs-receipt-sum">{charge.amount ? formatAmount(charge.amount) : ''}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="subs-why">
            {item.because === 'you'
              ? 'סימנת שזה מנוי.'
              : item.because === 'pace'
                ? `${sender.name} מחייב ${item.period ? EVERY[item.period] : 'שוב ושוב'} סכום דומה.`
                : 'בקבלות כתוב שזה מנוי.'}{' '}
            <button type="button" className="subs-not" onClick={drop}>
              זה לא מנוי
            </button>
          </p>
        </div>
      )}
    </li>
  )
}

/** Subscriptions: every sender that keeps charging, what it cost in the last year and what it costs a month now. */
export function SubscriptionsSheet({ onClose }: { onClose: () => void }) {
  const { notKinds, subscriptions: overrides } = useSettings()
  const [charges, setCharges] = useState<Charge[] | null>(null)
  const [threads, setThreads] = useState<Map<string, Thread>>(new Map())
  const [rates, setRates] = useState<Rates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    void shekelRates().then((found) => !cancelled && setRates(found))
    const collect = async () => {
      const found: Thread[] = []
      let pageToken: string | undefined
      do {
        const page = await listThreads({ q: SUBSCRIPTION_SEARCH }, pageToken, 100)
        found.push(...page.threads)
        pageToken = page.nextPageToken
      } while (pageToken && found.length < 300 && !cancelled)
      if (cancelled) return
      setThreads(new Map(found.map((thread) => [thread.id, thread])))
      // First from what the list knows (subject and first words), then from each whole letter.
      const byThread = new Map<string, Charge[]>()
      for (const thread of found) {
        const charge = readCharge({ thread: thread.id, at: Date.parse(thread.date), from: thread.from, subject: thread.subject, text: thread.snippet, receipt: false })
        byThread.set(thread.id, charge ? [charge] : [])
      }
      setCharges([...byThread.values()].flat())
      setReading(true)
      for (let index = 0; index < found.length && !cancelled; index += 4) {
        await Promise.all(
          found.slice(index, index + 4).map(async (thread) => {
            const messages = await loadMessages(thread).catch(() => null)
            if (!messages) return
            const read: Charge[] = []
            for (const message of messages) {
              if (message.isDraft || message.labelIds?.includes('SENT')) continue
              const charge = readCharge({
                thread: thread.id,
                at: Date.parse(message.date),
                from: message.from,
                subject: message.subject,
                text: letterText(message),
                receipt: !(notKinds[message.from.email.toLowerCase()] ?? []).includes('receipt') && /קבלה|חשבונית|receipt|invoice/i.test(message.subject),
              })
              if (charge) read.push(charge)
            }
            byThread.set(thread.id, read)
          }),
        )
        if (!cancelled) setCharges([...byThread.values()].flat())
      }
      if (!cancelled) setReading(false)
    }
    collect().catch((reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)))
    return () => {
      cancelled = true
    }
  }, [notKinds])

  const { subscriptions, others } = useMemo(() => gather(charges ?? [], now, overrides), [charges, now, overrides])
  const active = subscriptions.filter((item) => item.active)
  const ended = subscriptions.filter((item) => !item.active)
  const year = addUp(subscriptions.flatMap((item) => item.year))
  const month = addUp(active.map((item) => item.monthly))
  const yearShekels = rates ? inShekels(year, rates.rates) : null
  const monthShekels = rates ? inShekels(month, rates.rates) : null
  const several = (sums: Amount[]) => sums.length > 1 || (sums.length === 1 && sums[0]!.currency !== '₪')

  const open = (thread: Thread) => {
    mailbox.open(thread)
    onClose()
  }
  const add = (key: string) =>
    updateSettings({ subscriptions: { add: [...new Set([...overrides.add, key])], drop: overrides.drop.filter((item) => item !== key) } })

  return (
    <Sheet title="מנויים" form="טופס 20 · הוראות קבע" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {!charges && !error && <Loader compact label="מחפשים מנויים בקבלות…" />}
      {charges && (
        <>
          <div className="subs-ledger">
            <div>
              <span className="subs-ledger-label">בשנה האחרונה</span>
              <strong>{yearShekels !== null && several(year) ? `בערך ${shekels(yearShekels)}` : <Sums sums={year} />}</strong>
              {yearShekels !== null && several(year) && (
                <small>
                  <Sums sums={year} />
                </small>
              )}
            </div>
            <div>
              <span className="subs-ledger-label">כל חודש, עכשיו</span>
              <strong>{monthShekels !== null && several(month) ? `בערך ${shekels(monthShekels)}` : <Sums sums={month} />}</strong>
              <small>
                {active.length === 1 ? 'מנוי פעיל אחד' : `${active.length} מנויים פעילים`}
                {reading && ' · עוד קוראים קבלות…'}
              </small>
            </div>
          </div>

          {subscriptions.length === 0 && !reading && (
            <p className="muted">לא מצאנו מנויים בקבלות של השנה האחרונה. כשיגיעו קבלות של מנוי, הוא יופיע כאן מעצמו.</p>
          )}

          {active.length > 0 && (
            <ul className="subs-list" aria-label="מנויים פעילים">
              {active.map((item) => (
                <Card key={item.key} item={item} now={now} threads={threads} onOpen={open} />
              ))}
            </ul>
          )}

          {ended.length > 0 && (
            <>
              <h3 className="subs-title">נראה שהסתיימו</h3>
              <ul className="subs-list" aria-label="מנויים שנראה שהסתיימו">
                {ended.map((item) => (
                  <Card key={item.key} item={item} now={now} threads={threads} onOpen={open} />
                ))}
              </ul>
            </>
          )}

          {others.length > 0 && !reading && (
            <>
              <h3 className="subs-title">חייבו יותר מפעם אחת</h3>
              <p className="muted subs-hint">לא נראים כמו מנוי. אם אחד מהם כן, אפשר להוסיף אותו.</p>
              <ul className="subs-others">
                {others.map((item) => (
                  <li key={item.key}>
                    <span className="ellipsis" dir="auto">
                      {item.name}
                    </span>
                    <small>{item.charges.length} קבלות</small>
                    <button type="button" className="pill-btn" onClick={() => add(item.key)}>
                      זה מנוי
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="muted spike-note">
            נאסף מהקבלות שבדואר בשנה האחרונה, ויכול לטעות או לפספס מנוי שלא שולח קבלות.
            {rates && rates.date && ` סכומים במטבעות אחרים מחושבים בשקלים לפי השער של ${new Date(rates.date).toLocaleDateString('he-IL')}.`}
          </p>
        </>
      )}
    </Sheet>
  )
}
