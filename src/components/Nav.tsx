import { useState, type FormEvent, type ReactNode } from 'react'
import { newDraft } from '../lib/compose'
import { promptInstall, useInstall } from '../lib/install'
import { mailbox, useMailbox } from '../lib/mailbox'
import { FOLDER_TITLES, labelLeaf, viewKey, type FolderId, type View } from '../lib/views'
import {
  AllMailIcon,
  ArchiveIcon,
  ChevronIcon,
  ClockIcon,
  DraftIcon,
  HelpIcon,
  InboxIcon,
  InstallIcon,
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
import { Logo, TapeSwatch } from './Postal'

type Props = {
  /** On phones the folders live in a drawer; this says whether it's pulled out. */
  open: boolean
  onClose: () => void
  onSettings: () => void
  onShortcuts: () => void
  onGuide: () => void
}

type Folder = { id: FolderId; icon: ReactNode }

/** The folders of every day. */
const FOLDERS: Folder[] = [
  { id: 'inbox', icon: <InboxIcon /> },
  { id: 'starred', icon: <StarIcon /> },
  { id: 'drafts', icon: <DraftIcon /> },
  { id: 'scheduled', icon: <ClockIcon /> },
  { id: 'sent', icon: <SendIcon /> },
  { id: 'archive', icon: <ArchiveIcon /> },
]

/** Rarely needed, so they wait folded under "more". */
const MORE_FOLDERS: Folder[] = [
  { id: 'all', icon: <AllMailIcon /> },
  { id: 'spam', icon: <SpamIcon /> },
  { id: 'trash', icon: <TrashIcon /> },
]

const MORE_KEY = 'doar:nav-more'

function savedMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === '1'
  } catch {
    return false
  }
}

/** Folders and labels: a sidebar on wide screens, a drawer on phones. */
export function Nav({ open, onClose, onSettings, onShortcuts, onGuide }: Props) {
  const { view, unread, draftCount, labels, me, scheduled } = useMailbox()
  const install = useInstall()
  const [adding, setAdding] = useState(false)
  const [labelName, setLabelName] = useState('')
  const [more, setMore] = useState(savedMore)
  const current = viewKey(view)
  // Standing in one of the folded folders keeps them in view.
  const showMore = more || MORE_FOLDERS.some((folder) => folder.id === current)

  const toggleMore = () => {
    const next = !showMore
    setMore(next)
    try {
      localStorage.setItem(MORE_KEY, next ? '1' : '0')
    } catch {
      // Not remembered; it still works until the app closes.
    }
  }

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

  const folderButton = (folder: Folder) => {
    const active = current === folder.id || (folder.id === 'inbox' && current === 'unread')
    // Letters waiting for their time are drafts to Gmail, but here they have a folder of their own.
    const count =
      folder.id === 'inbox'
        ? unread
        : folder.id === 'drafts'
          ? Math.max(0, draftCount - scheduled.length)
          : folder.id === 'scheduled'
            ? scheduled.length
            : 0
    return (
      <button key={folder.id} className="nav-item" aria-current={active ? 'page' : undefined} onClick={() => go({ kind: 'folder', id: folder.id })}>
        {folder.icon}
        <span className="nav-name">{FOLDER_TITLES[folder.id]}</span>
        {count > 0 && <span className="count">{count}</span>}
      </button>
    )
  }

  return (
    <>
      {open && <button className="drawer-backdrop" aria-label="סגירת התיקיות" onClick={onClose} />}
      <aside className="sidebar" data-open={open || undefined}>
        <div className="brand">
          <Logo width={40} />
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
          {FOLDERS.map((folder) =>
            // The scheduled folder appears only while something waits in it.
            folder.id !== 'scheduled' || scheduled.length > 0 || current === 'scheduled' ? folderButton(folder) : null,
          )}
          <button className="nav-item nav-more" aria-expanded={showMore} onClick={toggleMore}>
            <ChevronIcon />
            <span className="nav-name">עוד</span>
          </button>
          {showMore && MORE_FOLDERS.map(folderButton)}

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
          {install.available && (
            <button
              className="nav-item"
              onClick={() => {
                void promptInstall()
                onClose()
              }}
            >
              <InstallIcon />
              <span className="nav-name">התקנת האפליקציה</span>
            </button>
          )}
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
            className="nav-item"
            onClick={() => {
              onGuide()
              onClose()
            }}
          >
            <HelpIcon />
            <span className="nav-name">מדריך קצר</span>
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
