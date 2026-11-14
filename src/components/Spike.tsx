import { useEffect, useState } from 'react'
import { shortName } from '../lib/addresses'
import { letterText, listThreads, loadMessages } from '../lib/gmail'
import { findAmount, formatAmount, RECEIPT_SEARCH, threadShape, type Amount } from '../lib/kinds'
import { mailbox } from '../lib/mailbox'
import { useSettings } from '../lib/settings'
import type { Thread } from '../types'
import { Loader } from './Loader'
import { Sheet } from './Sheets'

type Row = { thread: Thread; amount: Amount | null }
type Month = { key: string; title: string; rows: Row[]; sums: Amount[] }

/** Receipts by month, the newest month first, each with what it adds up to. */
function byMonth(rows: Row[]): Month[] {
  const months = new Map<string, Month>()
  for (const row of rows) {
    const date = new Date(row.thread.date)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    let month = months.get(key)
    if (!month) {
      month = { key, title: date.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }), rows: [], sums: [] }
      months.set(key, month)
    }
    month.rows.push(row)
    if (row.amount) {
      const sum = month.sums.find((item) => item.currency === row.amount!.currency)
      if (sum) sum.value += row.amount.value
      else month.sums.push({ ...row.amount })
    }
  }
  return [...months.values()].sort((a, b) => (a.key < b.key ? 1 : -1))
}

/** The receipts spike: every receipt and invoice of the last year, by month, with monthly sums. */
export function SpikeSheet({ onClose }: { onClose: () => void }) {
  const { notKinds } = useSettings()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const gather = async () => {
      const page = await listThreads({ q: RECEIPT_SEARCH }, undefined, 40)
      const found: Row[] = []
      for (const thread of page.threads) {
        const shape = threadShape(thread, notKinds)
        if (shape.kind === 'receipt') found.push({ thread, amount: shape.amount })
      }
      if (cancelled) return
      setRows([...found])
      // A letter's first words often carry one line of a receipt, or none. Every sum is read
      // again from the whole letter, a few letters at a time; letters kept on the device answer at once.
      for (let index = 0; index < found.length && !cancelled; index += 4) {
        await Promise.all(
          found.slice(index, index + 4).map(async (row) => {
            const messages = await loadMessages(row.thread).catch(() => null)
            const letter = messages?.findLast((message) => !message.isDraft)
            const sum = letter ? findAmount(`${letter.subject}\n${letterText(letter)}`) : null
            if (sum) row.amount = sum
          }),
        )
        if (!cancelled) setRows([...found])
      }
    }
    gather().catch((reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)))
    return () => {
      cancelled = true
    }
  }, [notKinds])

  const months = byMonth(rows ?? [])
  return (
    <Sheet title="דוקרן הקבלות" form="טופס 16 · ריכוז קבלות" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <Loader compact label="אוספים את הקבלות…" />}
      {rows && rows.length === 0 && <p className="muted">אין קבלות בשנה האחרונה. קבלה או חשבונית שתגיע תיאסף לכאן מעצמה.</p>}
      {months.map((month) => (
        <section key={month.key} className="spike-month">
          <header>
            <h3>{month.title}</h3>
            <span className="spike-sum">
              {month.sums.length === 0
                ? '—'
                : month.sums.map((sum, index) => (
                    <span key={sum.currency}>
                      {index > 0 && 'ועוד '}
                      {formatAmount(sum)}
                    </span>
                  ))}
            </span>
          </header>
          <ul>
            {month.rows.map(({ thread, amount }) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => {
                    mailbox.open(thread)
                    onClose()
                  }}
                >
                  <span className="spike-day">{new Date(thread.date).getDate()}</span>
                  <span className="spike-what">
                    <strong className="ellipsis" dir="auto">
                      {shortName(thread.from)}
                    </strong>
                    <span className="ellipsis" dir="auto">
                      {thread.subject}
                    </span>
                  </span>
                  <span className="spike-amount">{amount ? formatAmount(amount) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rows && rows.length > 0 && <p className="muted spike-note">הסכומים נקראים מהמכתבים עצמם ויכולים לטעות. זה ריכוז לנוחות, לא הנהלת חשבונות.</p>}
    </Sheet>
  )
}
