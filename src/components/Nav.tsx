import { useEffect, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { newDraft } from '../lib/compose'
import { promptInstall, useInstall } from '../lib/install'
import { mailbox, useMailbox } from '../lib/mailbox'
import { FOLDER_TITLES, labelLeaf, viewKey, type FolderId, type View } from '../lib/views'
import {
  AlbumIcon,
  AllMailIcon,
  ArchiveIcon,
  ChevronIcon,
  ClipIcon,
  ClockIcon,
  DraftIcon,
  EditIcon,
  HelpIcon,
  HoldIcon,
  InboxIcon,
  InstallIcon,
  KeyboardIcon,
  LogoutIcon,
  NibIcon,
  PlusIcon,
  RegisteredIcon,
  SendIcon,
  SettingsIcon,
  SpamIcon,
  SpikeIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
} from './icons'
import { carriesLetters, droppedLetters } from '../lib/dragging'
import { resolvedTheme, updateSettings } from '../lib/settings'
import { toast } from '../lib/toast'
import { Logo, TapeSwatch } from './Postal'

type Props = {
  /** On phones the folders live in a drawer; this says whether it's pulled out. */
  open: boolean
  onClose: () => void
  onSettings: () => void
  onShortcuts: () => void
  onGuide: () => void
  onRules: () => void
  onManageLabels: () => void
  onAlbum: () => void
  onSpike: () => void
  onFiles: () => void
}

type Folder = { id: FolderId; icon: ReactNode }

/** The folders of every day. */
const FOLDERS: Folder[] = [
  { id: 'inbox', icon: <InboxIcon /> },
  { id: 'starred', icon: <StarIcon /> },
  { id: 'scheduled', icon: <ClockIcon /> },
  { id: 'held', icon: <HoldIcon /> },
  { id: 'waiting', icon: <RegisteredIcon /> },
  { id: 'sent', icon: <SendIcon /> },
  { id: 'all', icon: <AllMailIcon /> },
]

/** Rarely needed, so they wait folded under "more". */
const MORE_FOLDERS: Folder[] = [
  { id: 'drafts', icon: <DraftIcon /> },
  { id: 'archive', icon: <ArchiveIcon /> },
  { id: 'spam', icon: <SpamIcon /> },
  { id: 'trash', icon: <TrashIcon /> },
]

const MORE_KEY = 'doar:nav-more'

/** What letters dropped on a folder do there. Folders not listed take no letters. */
const DROPS: Partial<Record<FolderId, (ids: string[]) => void>> = {
  inbox: (ids) => mailbox.moveToInbox(ids),
  archive: (ids) => mailbox.archive(ids),
  spam: (ids) => mailbox.spam(ids),
  trash: (ids) => mailbox.trash(ids),
}

function savedMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === '1'
  } catch {
    return false
  }
}

/** Folders and labels: a sidebar on wide screens, a drawer on phones. */
export function Nav({ open, onClose, onSettings, onShortcuts, onGuide, onRules, onManageLabels, onAlbum, onSpike, onFiles }: Props) {
  const { view, unread, draftCount, labels, me, scheduled, rules, reminders } = useMailbox()
  const keeping = (kind: 'hold' | 'reply') => reminders.filter((reminder) => reminder.kind === kind && reminder.status !== 'returned').length
  // Folders that exist only while something is in them.
  const kept: Partial<Record<FolderId, number>> = { scheduled: scheduled.length, held: keeping('hold'), waiting: keeping('reply') }
  const install = useInstall()
  const [adding, setAdding] = useState(false)
  const [labelName, setLabelName] = useState('')
  const [more, setMore] = useState(savedMore)
  const current = viewKey(view)
  // While letters are being dragged, every place that takes them is in view and says so.
  const [dragging, setDragging] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  useEffect(() => {
    const start = (event: globalThis.DragEvent) => carriesLetters(event) && setDragging(true)
    const end = () => {
      setDragging(false)
      setOver(null)
    }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])
  /** Makes a menu item a place to drop letters on. */
  const dropHere = (key: string, act: (ids: string[]) => void) => ({
    'data-drop': dragging ? (over === key ? 'over' : 'ready') : undefined,
    onDragOver: (event: DragEvent) => {
      if (!carriesLetters(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (over !== key) setOver(key)
    },
    onDragLeave: () => setOver((now) => (now === key ? null : now)),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const ids = droppedLetters(event)
      if (ids.length) act(ids)
    },
  })
  // Standing in one of the folded folders keeps them in view.
  const showMore = more || dragging || MORE_FOLDERS.some((folder) => folder.id === current)

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
          : (kept[folder.id] ?? 0)
    return (
      <button
        key={folder.id}
        className="nav-item"
        aria-current={active ? 'page' : undefined}
        onClick={() => go({ kind: 'folder', id: folder.id })}
        {...(DROPS[folder.id] ? dropHere(folder.id, DROPS[folder.id]!) : {})}
      >
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
          <button
            type="button"
            className="lamp-chain"
            onClick={() => updateSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' })}
            aria-label="שרשרת המנורה: מעבר בין יום ללילה"
            title="שרשרת המנורה: יום או לילה"
          >
            <span className="chain-beads" aria-hidden="true" />
            <span className="chain-pull" aria-hidden="true" />
          </button>
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
          {FOLDERS.map((folder) => (!(folder.id in kept) || kept[folder.id]! > 0 || current === folder.id ? folderButton(folder) : null))}
          <button className="nav-item nav-more" aria-expanded={showMore} onClick={toggleMore}>
            <ChevronIcon />
            <span className="nav-name">עוד</span>
          </button>
          {showMore && MORE_FOLDERS.map(folderButton)}

          <div className="nav-heading">
            <span>תוויות</span>
            <span className="nav-heading-tools">
              {labels.length > 0 && (
                <button
                  className="nav-add"
                  onClick={() => {
                    onManageLabels()
                    onClose()
                  }}
                  aria-label="ניהול תוויות"
                  title="ניהול תוויות: שם, צבע, מחיקה"
                >
                  <EditIcon />
                </button>
              )}
              <button className="nav-add" onClick={() => setAdding((value) => !value)} aria-label="תווית חדשה" title="תווית חדשה">
                <PlusIcon />
              </button>
            </span>
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
              {...dropHere(`label:${label.id}`, (ids) => {
                mailbox.setLabel(ids, label.id, true)
                toast(ids.length === 1 ? `המכתב קיבל את התווית „${labelLeaf(label.name)}”` : `${ids.length} מכתבים קיבלו את התווית „${labelLeaf(label.name)}”`)
              })}
            >
              <TapeSwatch label={label} />
              <span className="nav-name ellipsis">{labelLeaf(label.name)}</span>
            </button>
          ))}
          {labels.length === 0 && !adding && <p className="nav-empty">עוד אין תוויות.</p>}
          <button
            className="nav-item nav-rules"
            onClick={() => {
              onRules()
              onClose()
            }}
          >
            <TagIcon />
            <span className="nav-name">תיוג אוטומטי</span>
            {rules.length > 0 && <span className="count">{rules.length}</span>}
          </button>
          <button
            className="nav-item"
            onClick={() => {
              onAlbum()
              onClose()
            }}
          >
            <AlbumIcon />
            <span className="nav-name">אלבום הבולים</span>
          </button>
          <button
            className="nav-item"
            onClick={() => {
              onSpike()
              onClose()
            }}
          >
            <SpikeIcon />
            <span className="nav-name">דוקרן הקבלות</span>
          </button>
          <button
            className="nav-item"
            onClick={() => {
              onFiles()
              onClose()
            }}
          >
            <ClipIcon />
            <span className="nav-name">מגירת הקבצים</span>
          </button>
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
