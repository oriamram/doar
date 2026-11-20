import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'
import { arranged, countLabel, dayLabel, MAX_LENGTH, tilt, whenLabel, type Note } from './lib/notes.ts'
import { hand, notesStore, useNotes } from './lib/store.ts'

/** How long a thrown note can still be brought back. */
const UNDO_MS = 6000

const newId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

/** The desk: the pad that new notes are torn from, and the notes lying on it. */
export default function App() {
  const { notes, unsaved } = useNotes()
  /** The note in hand (being read or written on), by its id; a fresh slip has an id and no note yet. */
  const [open, setOpen] = useState<string | null>(null)
  /** The note thrown away last; for a few seconds it can be brought back. */
  const [thrown, setThrown] = useState<Note | null>(null)
  const [now, setNow] = useState(() => Date.now())
  /** "Back" was asked for and has not happened yet: a second press must not leave the app. */
  const leaving = useRef(false)

  const lying = arranged(notes).filter((note) => note.text.trim() !== '')
  const inHand = open === null ? null : (notes.find((note) => note.id === open) ?? null)

  /** Take a note in hand. The phone's Back then puts it back instead of leaving the app. */
  const take = (id: string) => {
    window.history.pushState({ note: id }, '')
    setNow(Date.now())
    setOpen(id)
  }

  /** The note is back on the desk: an empty slip is not kept, and the keyboard returns to where it was. */
  const landed = (id: string) => {
    leaving.current = false
    notesStore.tidy()
    setOpen(null)
    setNow(Date.now())
    requestAnimationFrame(() => {
      const slip = document.querySelector<HTMLElement>(`[data-note="${CSS.escape(id)}"]`)
      ;(slip ?? document.querySelector<HTMLElement>('.pad'))?.focus({ preventScroll: true })
    })
  }

  const putBack = () => {
    if (open === null || leaving.current) return
    if (window.history.state?.note) {
      leaving.current = true
      window.history.back()
    } else landed(open)
  }

  const throwAway = (note: Note) => {
    notesStore.discard(note.id)
    setThrown(note)
    putBack()
  }

  const bringBack = () => {
    if (thrown) notesStore.restore(thrown)
    setThrown(null)
  }

  // The phone's Back, and the keyboard. Both are listened to once, and always see the note that is in hand now.
  const onBack = useEffectEvent(() => {
    if (open !== null) landed(open)
  })
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (open !== null) {
      if (event.key === 'Escape') putBack()
      return
    }
    // On a PC, "n" tears a new note off the pad (the key itself, whatever language the keyboard is in).
    const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))
    if (event.code !== 'KeyN' || event.ctrlKey || event.metaKey || event.altKey || typing) return
    event.preventDefault()
    take(newId())
  })
  useEffect(() => {
    window.addEventListener('popstate', onBack)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onBack)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // A new version of the app waits while a note is in hand (see main.tsx).
  useEffect(() => {
    hand.busy = open !== null
  }, [open])

  // The thrown note waits a few seconds for "ביטול", then it is gone.
  useEffect(() => {
    if (!thrown) return
    const timer = setTimeout(() => setThrown(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [thrown])

  // "היום" and "אתמול" are told again when the app is come back to.
  useEffect(() => {
    const onShow = () => !document.hidden && setNow(Date.now())
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [])

  // While a note is in hand, the desk behind it can be neither pressed nor reached with the keyboard.
  const behind = open !== null

  return (
    <div className="desk">
      <header className="top" inert={behind}>
        <h1>פתקיות</h1>
        {lying.length > 0 && <span className="top-count">{countLabel(lying.length)}</span>}
      </header>

      <main inert={behind}>
        <ul className="slips">
          <li className="pad-cell">
            <button type="button" className="pad" onClick={() => take(newId())}>
              <span className="pad-glue" aria-hidden="true" />
              <svg className="pad-plus" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4.5v15M4.5 12h15" />
              </svg>
              <span className="pad-label">פתק חדש</span>
            </button>
          </li>
          {lying.map((note) => (
            <li key={note.id}>
              <button type="button" className="slip" data-note={note.id} style={{ '--tilt': `${tilt(note.id)}deg` } as CSSProperties} onClick={() => take(note.id)}>
                <span className="slip-text" dir="auto">
                  {note.text}
                </span>
                <span className="slip-day">{dayLabel(note.updatedAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
        {lying.length === 0 && <p className="empty">עוד אין כאן פתקים. לחיצה על „פתק חדש” תולשת אחד מהבלוק, ומה שנכתב עליו נשאר על השולחן.</p>}
      </main>

      <footer className="where" inert={behind}>
        {unsaved ? (
          <p className="where-problem" role="alert">
            השינוי האחרון לא נשמר: האחסון של הדפדפן מלא או חסום. כדאי להעתיק את הפתק למקום אחר לפני שסוגרים.
          </p>
        ) : (
          <p>בינתיים הפתקים נשמרים במכשיר הזה בלבד.</p>
        )}
      </footer>

      {open !== null && <InHand key={open} id={open} note={inHand} now={now} onDone={putBack} onThrow={throwAway} />}

      {thrown && (
        <div className="receipts" role="status" aria-live="polite">
          <div className="receipt" key={thrown.id}>
            <span className="receipt-text">הפתק נזרק.</span>
            <button type="button" className="receipt-action" onClick={bringBack}>
              ביטול
            </button>
            <span className="receipt-timer" style={{ animationDuration: `${UNDO_MS}ms` }} aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  )
}

type InHandProps = {
  id: string
  /** The note as it is saved; null for a fresh slip nothing was written on yet. */
  note: Note | null
  now: number
  onDone: () => void
  onThrow: (note: Note) => void
}

/** A note in hand: larger, over the dimmed desk, with the pen already on it. Every letter is saved as it is written. */
function InHand({ id, note, now, onDone, onThrow }: InHandProps) {
  const [draft, setDraft] = useState(note?.text ?? '')
  const paper = useRef<HTMLTextAreaElement>(null)

  // The pen goes to the end of what is already written.
  useEffect(() => {
    const field = paper.current
    if (!field) return
    field.focus({ preventScroll: true })
    field.setSelectionRange(field.value.length, field.value.length)
  }, [])

  return (
    <div
      className="in-hand"
      role="dialog"
      aria-modal="true"
      aria-label={note ? 'פתק' : 'פתק חדש'}
      onPointerDown={(event) => {
        // A press on the dimmed desk around the note puts it back.
        if (event.target === event.currentTarget) onDone()
      }}
    >
      <div className="slip slip-open">
        <textarea
          ref={paper}
          className="slip-paper"
          dir="auto"
          maxLength={MAX_LENGTH}
          placeholder="מה לזכור?"
          aria-label="מה כתוב בפתק"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            notesStore.write(id, event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onDone()
          }}
        />
        <div className="slip-actions">
          <button type="button" className="slip-done" onClick={onDone}>
            סיום
          </button>
          {note && (
            <button type="button" className="slip-throw" onClick={() => onThrow(note)}>
              לפח
            </button>
          )}
          <span className="slip-when">{note ? whenLabel(note.updatedAt, now) : 'נשמר תוך כדי כתיבה'}</span>
        </div>
      </div>
    </div>
  )
}
