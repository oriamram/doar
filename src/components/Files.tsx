import { useEffect, useState } from 'react'
import { shortName } from '../lib/addresses'
import { realAttachments } from '../lib/compose'
import { formatBytes, formatListDate } from '../lib/format'
import { listThreads, loadMessages } from '../lib/gmail'
import { mailbox } from '../lib/mailbox'
import type { Attachment, Contact, Thread } from '../types'
import { Loader } from './Loader'
import { Sheet } from './Sheets'

type Row = { thread: Thread; from: Contact; date: string; file: Attachment }
type Sort = 'all' | 'pictures' | 'papers' | 'other'

const SORTS: [Sort, string][] = [
  ['all', 'הכל'],
  ['pictures', 'תמונות'],
  ['papers', 'מסמכים'],
  ['other', 'אחר'],
]

const PAPER = /pdf|msword|officedocument|opendocument|spreadsheet|presentation|text\/|rtf|csv/i

function sortOf(file: Attachment): Exclude<Sort, 'all'> {
  if (file.mimeType.startsWith('image/')) return 'pictures'
  return PAPER.test(file.mimeType) || /\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt|ods)$/i.test(file.filename) ? 'papers' : 'other'
}

const kindOf = (file: Attachment) => (file.filename.includes('.') ? file.filename.split('.').pop()!.slice(0, 4).toUpperCase() : 'קובץ')

/** The files drawer: every file that came by mail lately, newest first; a press goes to its letter. */
export function FilesDrawer({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('all')

  useEffect(() => {
    let cancelled = false
    const gather = async () => {
      const page = await listThreads({ q: 'has:attachment -in:drafts' }, undefined, 30)
      const found: Row[] = []
      if (!cancelled) setRows([])
      // The list says only that a letter carries files; the files are named in the letters themselves.
      for (let index = 0; index < page.threads.length && !cancelled; index += 4) {
        const opened = await Promise.all(page.threads.slice(index, index + 4).map((thread) => loadMessages(thread).then((messages) => ({ thread, messages }), () => null)))
        for (const item of opened) {
          if (!item) continue
          for (const message of item.messages) {
            if (message.isDraft) continue
            for (const file of realAttachments(message)) found.push({ thread: item.thread, from: message.from, date: message.date, file })
          }
        }
        found.sort((a, b) => (a.date < b.date ? 1 : -1))
        if (!cancelled) setRows([...found])
      }
    }
    gather().catch((reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)))
    return () => {
      cancelled = true
    }
  }, [])

  const shown = (rows ?? []).filter((row) => sort === 'all' || sortOf(row.file) === sort)
  return (
    <Sheet title="מגירת הקבצים" form="טופס 18 · קבצים שהגיעו בדואר" onClose={onClose}>
      <div className="segments drawer-sorts" role="radiogroup" aria-label="סוג הקבצים">
        {SORTS.map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={sort === value} onClick={() => setSort(value)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <Loader compact label="פותחים את המגירה…" />}
      {rows && shown.length === 0 && <p className="muted">{rows.length === 0 ? 'עוד לא הגיעו קבצים בדואר.' : 'אין במגירה קבצים מהסוג הזה.'}</p>}
      <ul className="drawer-files">
        {shown.map((row) => (
          <li key={row.file.key}>
            <button
              type="button"
              className="file-slip drawer-file"
              onClick={() => {
                mailbox.open(row.thread)
                onClose()
              }}
              title="פתיחת המכתב שהקובץ הגיע בו"
            >
              <span className="file-kind" data-sort={sortOf(row.file)}>
                {kindOf(row.file)}
              </span>
              <span className="file-text">
                <span className="file-name ellipsis" dir="auto">
                  {row.file.filename}
                </span>
                {/* The sender's name gives way when the line is short; the day and the size always show.
                    Each part keeps to itself, so a name in Latin letters does not pull the day's number to its side. */}
                <span className="file-size drawer-meta">
                  <span className="drawer-from ellipsis" dir="auto">
                    {shortName(row.from)}
                  </span>
                  <span className="drawer-when">
                    · <bdi>{formatListDate(row.date)}</bdi> · <bdi dir="ltr">{formatBytes(row.file.size)}</bdi>
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
