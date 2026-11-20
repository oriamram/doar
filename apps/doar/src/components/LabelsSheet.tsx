import { useState, type FormEvent } from 'react'
import { LABEL_COLORS } from '../lib/gmail'
import { mailbox, useMailbox } from '../lib/mailbox'
import { labelLeaf } from '../lib/views'
import type { Label } from '../types'
import { EditIcon, TrashIcon } from './icons'
import { LabelTape } from './Postal'
import { Sheet } from './Sheets'

const COLOR_NAMES: Record<string, string> = {
  '#fb4c2f': 'אדום',
  '#ffad47': 'כתום',
  '#fad165': 'צהוב',
  '#16a766': 'ירוק',
  '#43d692': 'ירוק בהיר',
  '#4a86e8': 'כחול',
  '#a479e2': 'סגול',
  '#f691b3': 'ורוד',
}

/** One label being changed: its name, its tape color, or its removal. */
function LabelEditor({ label, onDone }: { label: Label; onDone: () => void }) {
  const [name, setName] = useState(label.name)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const rename = async (e: FormEvent) => {
    e.preventDefault()
    const next = name.trim()
    if (!next || next === label.name) {
      onDone()
      return
    }
    setBusy(true)
    const saved = await mailbox.changeLabel(label.id, { name: next })
    setBusy(false)
    if (saved) onDone()
  }

  const remove = async () => {
    setBusy(true)
    const removed = await mailbox.removeLabel(label.id)
    setBusy(false)
    if (removed) onDone()
  }

  return (
    <form className="label-editor" onSubmit={rename}>
      <input value={name} onChange={(e) => setName(e.target.value)} dir="auto" aria-label="שם התווית" autoFocus />
      <div className="swatches" role="radiogroup" aria-label="צבע הסרט">
        <button
          type="button"
          role="radio"
          className="swatch swatch-none"
          aria-checked={!label.color}
          aria-label="בלי צבע"
          title="בלי צבע: דואר בוחר סרט"
          onClick={() => void mailbox.changeLabel(label.id, { color: null })}
        />
        {LABEL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            className="swatch"
            style={{ background: color }}
            aria-checked={label.color === color}
            aria-label={COLOR_NAMES[color]}
            title={COLOR_NAMES[color]}
            onClick={() => void mailbox.changeLabel(label.id, { color })}
          />
        ))}
      </div>
      <div className="label-editor-actions">
        <button type="submit" className="pill-btn" disabled={busy}>
          שמירה
        </button>
        <button type="button" className="link-btn" onClick={onDone}>
          ביטול
        </button>
        <span className="spacer" />
        {confirming ? (
          <button type="button" className="pill-btn danger" disabled={busy} onClick={() => void remove()}>
            כן, למחוק את התווית
          </button>
        ) : (
          <button type="button" className="icon-btn" onClick={() => setConfirming(true)} aria-label={`מחיקת התווית ${label.name}`} title="מחיקת התווית">
            <TrashIcon />
          </button>
        )}
      </div>
      {confirming && <p className="setting-note">המכתבים עצמם נשארים. רק התווית יורדת מהם, והכללים האוטומטיים שלה מתבטלים.</p>}
    </form>
  )
}

/** Your labels: rename one, give its tape a color, remove it, or make a new one. */
export function LabelsSheet({ onClose }: { onClose: () => void }) {
  const { labels } = useMailbox()
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (await mailbox.addLabel(name)) setName('')
  }

  return (
    <Sheet title="ניהול תוויות" form="טופס 5 · רישום תוויות" onClose={onClose}>
      {labels.length === 0 && <p className="muted">עוד אין תוויות. אפשר ליצור אחת כאן למטה.</p>}
      <div className="label-list">
        {labels.map((label) =>
          editing === label.id ? (
            <LabelEditor key={label.id} label={label} onDone={() => setEditing(null)} />
          ) : (
            <div key={label.id} className="label-row label-manage" data-depth={Math.min(label.name.split('/').length - 1, 2) || undefined}>
              <LabelTape label={label} />
              {label.name.includes('/') && <span className="label-path">{label.name.split('/').slice(0, -1).map(labelLeaf).join(' / ')}</span>}
              <span className="spacer" />
              <button type="button" className="icon-btn" onClick={() => setEditing(label.id)} aria-label={`עריכת התווית ${label.name}`} title="עריכה">
                <EditIcon />
              </button>
            </div>
          ),
        )}
      </div>
      <form className="label-new" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="תווית חדשה" aria-label="שם התווית החדשה" dir="auto" />
        <button type="submit" className="pill-btn" disabled={!name.trim()}>
          הוספה
        </button>
      </form>
      <p className="setting-note">אלה התוויות של Gmail: מה שמשנים כאן משתנה גם שם.</p>
    </Sheet>
  )
}
