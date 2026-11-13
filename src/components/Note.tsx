import { useState } from 'react'
import { mailbox } from '../lib/mailbox'

type Props = {
  threadId: string
  /** The note as it is saved ("" when there is none yet). */
  text: string
  /** Start with the pen down (a new note, or the reader asked to change it). */
  writing: boolean
  onDone: () => void
}

/** Your own note on a letter: a yellow slip under a paperclip. Only you see it; it is never part of the letter. */
export function NoteSlip({ threadId, text, writing, onDone }: Props) {
  const [draft, setDraft] = useState(text)
  const [editing, setEditing] = useState(writing)
  const open = editing || writing

  const save = () => {
    const next = draft.trim()
    if (next !== text) void mailbox.setNote(threadId, next)
    setEditing(false)
    onDone()
  }
  const cancel = () => {
    setDraft(text)
    setEditing(false)
    onDone()
  }

  return (
    <div className="note-slip" data-editing={open || undefined}>
      <svg className="note-clip" width="14" height="34" viewBox="0 0 11 26" aria-hidden="true">
        <path d="M8.6 6.5v12a3.05 3.05 0 0 1-6.1 0V5.4a2 2 0 0 1 4 0V17a.95.95 0 0 1-1.9 0V7.2" />
      </svg>
      {open ? (
        <>
          <textarea
            className="note-text"
            dir="auto"
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            maxLength={4000}
            placeholder="פתק לעצמך: מה לזכור על המכתב הזה"
            aria-label="פתק על המכתב"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
              if (e.key === 'Escape') {
                e.stopPropagation()
                cancel()
              }
            }}
            autoFocus
          />
          <span className="note-actions">
            <button type="button" className="note-save" onClick={save}>
              שמירה
            </button>
            {text && (
              <button
                type="button"
                onClick={() => {
                  void mailbox.setNote(threadId, '')
                  setDraft('')
                  setEditing(false)
                  onDone()
                }}
              >
                להסיר את הפתק
              </button>
            )}
            <button type="button" onClick={cancel}>
              ביטול
            </button>
          </span>
        </>
      ) : (
        <button type="button" className="note-text note-read" dir="auto" onClick={() => setEditing(true)} title="לחיצה עורכת את הפתק">
          {text}
        </button>
      )}
    </div>
  )
}
