import { useState, type FormEvent, type ReactNode } from 'react'
import { newDraft } from '../lib/compose'
import { mailbox, useMailbox } from '../lib/mailbox'
import { FOLDER_TITLES, labelLeaf, viewKey, type FolderId, type View } from '../lib/views'
import {
  AllMailIcon,
  DraftIcon,
  InboxIcon,
  KeyboardIcon,
  LogoutIcon,
  NibIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  SpamIcon,
  StarIcon,
  TrashIcon,
} from './icons'
import { DoarMark, TapeSwatch } from './Postal'

type Props = {
  /** On phones the folders live in a drawer; this says whether it's pulled out. */
  open: boolean
  onClose: () => void
  onSettings: () => void
  onShortcuts: () => void
}

const FOLDERS: { id: FolderId; icon: ReactNode }[] = [
  { id: 'inbox', icon: <InboxIcon /> },
  { id: 'starred', icon: <StarIcon /> },
  { id: 'sent', icon: <SendIcon /> },
  { id: 'drafts', icon: <DraftIcon /> },
  { id: 'all', icon: <AllMailIcon /> },
  { id: 'spam', icon: <SpamIcon /> },
  { id: 'trash', icon: <TrashIcon /> },
]

/** Folders and labels: a sidebar on wide screens, a drawer on phones. */
export function Nav({ open, onClose, onSettings, onShortcuts }: Props) {
  const { view, unread, draftCount, labels, me } = useMailbox()
  const [adding, setAdding] = useState(false)
  const [labelName, setLabelName] = useState('')
  const current = viewKey(view)

  const go = (next: View) => {
    mailbox.show(next)
    onClose()
  }

  const addLabel = async (e: FormEvent) => {
    e.preventDefault()
    const name = labelName.trim()
    if (!name) return
    const label = await mailbox.addLabel(name)
    if (label) {
      setLabelName('')
      setAdding(false)
    }
  }

  return (
    <>
      {open && <button className="drawer-backdrop" aria-label="סגירת התיקיות" onClick={onClose} />}
      <aside className="sidebar" data-open={open || undefined}>
        <div className="brand">
          <DoarMark size={30} />
          דואר
        </div>

        <button
          className="compose-label"
          onClick={() => {
            mailbox.compose(newDraft())
            onClose()
          }}
        >
          <NibIcon />
          <span>מכתב חדש</span>
        </button>

        <nav aria-label="תיקיות">
          {FOLDERS.map((folder) => {
            const active = current === folder.id || (folder.id === 'inbox' && current === 'unread')
            const count = folder.id === 'inbox' ? unread : folder.id === 'drafts' ? draftCount : 0
            return (
              <button key={folder.id} className="nav-item" aria-current={active ? 'page' : undefined} onClick={() => go({ kind: 'folder', id: folder.id })}>
                {folder.icon}
                <span className="nav-name">{FOLDER_TITLES[folder.id]}</span>
                {count > 0 && <span className="count">{count}</span>}
              </button>
            )
          })}

          <div className="nav-heading">
            <span>תוויות</span>
            <button className="nav-add" onClick={() => setAdding((value) => !value)} aria-label="תווית חדשה" title="תווית חדשה">
              <PlusIcon />
            </button>
          </div>
          {adding && (
            <form className="nav-new" onSubmit={addLabel}>
              <input value={labelName} onChange={(e) => setLabelName(e.target.value)} placeholder="שם התווית" aria-label="שם התווית החדשה" autoFocus />
              <button type="submit">הוספה</button>
            </form>
          )}
          {labels.map((label) => (
            <button
              key={label.id}
              className="nav-item nav-label"
              data-depth={Math.min(label.name.split('/').length - 1, 2) || undefined}
              aria-current={current === `label:${label.id}` ? 'page' : undefined}
              onClick={() => go({ kind: 'label', id: label.id, name: label.name })}
            >
              <TapeSwatch label={label} />
              <span className="nav-name ellipsis">{labelLeaf(label.name)}</span>
            </button>
          ))}
          {labels.length === 0 && !adding && <p className="nav-empty">עוד אין תוויות.</p>}
        </nav>

        <div className="account">
          <button
            className="nav-item"
            onClick={() => {
              onSettings()
              onClose()
            }}
          >
            <SettingsIcon />
            <span className="nav-name">הגדרות</span>
          </button>
          <button
            className="nav-item nav-keys"
            onClick={() => {
              onShortcuts()
              onClose()
            }}
          >
            <KeyboardIcon />
            <span className="nav-name">קיצורי מקלדת</span>
          </button>
          <div className="account-row">
            <span className="muted account-email" title={me.email} dir="ltr">
              {me.email}
            </span>
            <button className="icon-btn" onClick={mailbox.signOut} aria-label="התנתקות" title="התנתקות">
              <LogoutIcon />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
