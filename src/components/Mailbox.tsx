import { useEffect, useState } from 'react'
import { newDraft } from '../lib/compose'
import { peekMessages } from '../lib/gmail'
import { hasOpenLayers, useBackLayer } from '../lib/layers'
import { initMailbox, mailbox, useMailbox } from '../lib/mailbox'
import { onAndroidBack } from '../lib/platform'
import { INBOX, isFolder, type FolderId } from '../lib/views'
import { Compose } from './Compose'
import { Loader } from './Loader'
import { Nav } from './Nav'
import { SendFlight } from './SendFlight'
import { LabelSheet, SettingsSheet, ShortcutsSheet } from './Sheets'
import { ThreadList } from './ThreadList'
import { ThreadView } from './ThreadView'
import { Toasts } from './Toasts'

type Sheet = { kind: 'settings' } | { kind: 'shortcuts' } | { kind: 'labels'; ids: string[] } | null

const GO_TO: Record<string, FolderId> = { i: 'inbox', s: 'starred', t: 'sent', d: 'drafts', a: 'all' }

/** The whole mail app: folders, the list, the letter being read, and whatever is open on top. */
export function Mailbox({ email, name }: { email: string; name: string }) {
  useState(() => initMailbox({ email, name: name || email }))
  const state = useMailbox()
  const [drawer, setDrawer] = useState(false)
  const [searching, setSearching] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)

  useEffect(() => {
    mailbox.start()
    return mailbox.stop
  }, [])

  // The phone's Back closes what's open, innermost first, before leaving the app.
  const atInbox = isFolder(state.view, 'inbox')
  useBackLayer(!atInbox, () => {
    setSearching(false)
    mailbox.show(INBOX)
  })
  useBackLayer(searching, () => setSearching(false))
  useBackLayer(drawer, () => setDrawer(false))
  useBackLayer(state.selection.size > 0, mailbox.clearSelection)
  useBackLayer(state.open !== null, mailbox.close)
  useEffect(
    () =>
      onAndroidBack(() => {
        if (!hasOpenLayers()) return false
        history.back()
        return true
      }),
    [],
  )

  // PC keyboard shortcuts (the "?" key lists them).
  useEffect(() => {
    let prefix = ''
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Typing in a box is typing, not a shortcut.
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const now = mailbox.state()
      if (now.compose || sheet) return
      const list = now.threads ?? []
      const index = now.open ? list.findIndex((thread) => thread.id === now.open!.id) : -1
      const targets = now.selection.size ? [...now.selection] : now.open ? [now.open.id] : []
      const latest = now.open ? peekMessages(now.open)?.findLast((message) => !message.isDraft) : undefined

      if (prefix === 'g') {
        prefix = ''
        const folder = GO_TO[e.key]
        if (folder) mailbox.show({ kind: 'folder', id: folder })
        return
      }
      switch (e.key) {
        case 'g':
          prefix = 'g'
          setTimeout(() => (prefix = ''), 1200)
          break
        case 'c':
          mailbox.compose(newDraft())
          break
        case '/':
          e.preventDefault()
          setSearching(true)
          break
        case '?':
          setSheet({ kind: 'shortcuts' })
          break
        case 'j':
          if (list[index + 1]) mailbox.open(list[index + 1]!)
          break
        case 'k':
          if (index > 0) mailbox.open(list[index - 1]!)
          break
        case 'u':
        case 'Escape':
          if (now.selection.size) mailbox.clearSelection()
          else mailbox.close()
          break
        case 'e':
          if (targets.length) mailbox.archive(targets)
          break
        case '#':
        case 'Delete':
          if (targets.length) mailbox.trash(targets)
          break
        case 's':
          if (now.open) mailbox.toggleStar(now.open.id)
          break
        case 'x':
          if (now.open) mailbox.toggleSelect(now.open.id)
          break
        case 'U':
          if (targets.length) {
            mailbox.setRead(targets, false, { announce: true })
            mailbox.close()
          }
          break
        case 'r':
          if (latest) mailbox.reply(latest, 'reply')
          break
        case 'a':
          if (latest) mailbox.reply(latest, 'replyAll')
          break
        case 'f':
          if (latest) mailbox.reply(latest, 'forward')
          break
        default:
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])

  // The very first visit has nothing to show yet: one calm loader instead of an empty desk.
  if (state.threads === null && !state.error && atInbox) return <Loader />

  return (
    <div className="app" data-view={state.open ? 'thread' : 'list'}>
      <Nav
        open={drawer}
        onClose={() => setDrawer(false)}
        onSettings={() => setSheet({ kind: 'settings' })}
        onShortcuts={() => setSheet({ kind: 'shortcuts' })}
      />

      <ThreadList
        searching={searching || state.view.kind === 'search'}
        onSearching={setSearching}
        onMenu={() => setDrawer(true)}
        onAccount={() => setSheet({ kind: 'settings' })}
        onLabels={(ids) => setSheet({ kind: 'labels', ids })}
      />

      <main className="reader">
        {state.open ? (
          <ThreadView
            key={state.open.id}
            thread={state.open}
            onBack={mailbox.close}
            onLabels={() => setSheet({ kind: 'labels', ids: [state.open!.id] })}
          />
        ) : (
          <div className="reader-empty">
            <img src="/logo.svg" alt="" width={64} height={64} />
            <p className="big">בחרו מכתב כדי לפתוח אותו</p>
            <p className="muted hint">
              <kbd>c</kbd> מכתב חדש · <kbd>/</kbd> חיפוש · <kbd>?</kbd> כל הקיצורים
            </p>
          </div>
        )}
      </main>

      {state.compose && <Compose key={state.composeKey} initial={state.compose} />}
      {state.flight && <SendFlight to={state.flight.to} />}
      {sheet?.kind === 'settings' && <SettingsSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'shortcuts' && <ShortcutsSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'labels' && <LabelSheet ids={sheet.ids} onClose={() => setSheet(null)} />}
      <Toasts />
    </div>
  )
}
