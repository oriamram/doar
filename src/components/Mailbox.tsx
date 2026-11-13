import { useCallback, useEffect, useState } from 'react'
import { newDraft } from '../lib/compose'
import { peekMessages } from '../lib/gmail'
import { hasOpenLayers, useBackLayer } from '../lib/layers'
import { initMailbox, mailbox, useMailbox } from '../lib/mailbox'
import type { Contact } from '../types'
import { onAndroidBack } from '../lib/platform'
import { INBOX, isFolder, type FolderId } from '../lib/views'
import { Compose } from './Compose'
import { LabelsSheet } from './LabelsSheet'
import { Loader } from './Loader'
import { Nav } from './Nav'
import { SenderCard, StampAlbum } from './People'
import { Logo } from './Postal'
import { SendFlight } from './SendFlight'
import { GuideSheet, HoldSheet, LabelSheet, RegisterSheet, RulesSheet, SettingsSheet, ShortcutsSheet } from './Sheets'
import { SpikeSheet } from './Spike'
import { ThreadList } from './ThreadList'
import { ThreadView } from './ThreadView'
import { Toasts } from './Toasts'

type Sheet =
  | { kind: 'settings' }
  | { kind: 'shortcuts' }
  | { kind: 'guide' }
  | { kind: 'labels'; ids: string[] }
  | { kind: 'manage-labels' }
  | { kind: 'hold'; ids: string[]; current?: string }
  | { kind: 'register'; threadId: string; messageId: string }
  | { kind: 'rules'; from?: string; labelId?: string }
  | { kind: 'person'; contact: Contact }
  | { kind: 'album' }
  | { kind: 'spike' }
  | null

const GO_TO: Record<string, FolderId> = { i: 'inbox', s: 'starred', t: 'sent', d: 'drafts', a: 'all' }

/** The whole mail app: folders, the list, the letter being read, and whatever is open on top. */
export function Mailbox({ email, name }: { email: string; name: string }) {
  useState(() => initMailbox({ email, name: name || email }))
  const state = useMailbox()
  const [drawer, setDrawer] = useState(false)
  const [searching, setSearching] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const holdLetters = useCallback((ids: string[]) => setSheet({ kind: 'hold', ids }), [])

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
        case 'b':
          if (targets.length) setSheet({ kind: 'hold', ids: targets })
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
      // The key did its job; it must not also be typed into the form it just opened.
      e.preventDefault()
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
        onGuide={() => setSheet({ kind: 'guide' })}
        onRules={() => setSheet({ kind: 'rules' })}
        onManageLabels={() => setSheet({ kind: 'manage-labels' })}
        onAlbum={() => setSheet({ kind: 'album' })}
        onSpike={() => setSheet({ kind: 'spike' })}
      />

      <ThreadList
        searching={searching || state.view.kind === 'search'}
        onSearching={setSearching}
        onMenu={() => setDrawer(true)}
        onAccount={() => setSheet({ kind: 'settings' })}
        onLabels={(ids) => setSheet({ kind: 'labels', ids })}
        onHold={holdLetters}
      />

      <main className="reader">
        {state.open ? (
          <ThreadView
            key={state.open.id}
            thread={state.open}
            onBack={mailbox.close}
            onLabels={() => setSheet({ kind: 'labels', ids: [state.open!.id] })}
            onHold={(current) => setSheet({ kind: 'hold', ids: [state.open!.id], current })}
            onRegister={(messageId) => setSheet({ kind: 'register', threadId: state.open!.id, messageId })}
            onPerson={(contact) => setSheet({ kind: 'person', contact })}
          />
        ) : (
          <div className="reader-empty">
            <Logo width={132} />
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
      {sheet?.kind === 'guide' && <GuideSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'labels' && (
        <LabelSheet ids={sheet.ids} onClose={() => setSheet(null)} onRules={(from, labelId) => setSheet({ kind: 'rules', from, labelId })} />
      )}
      {sheet?.kind === 'manage-labels' && <LabelsSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'hold' && (
        <HoldSheet
          current={sheet.current}
          onPick={(when) => {
            // A letter that is already held just moves to the new time.
            if (sheet.current) void mailbox.rehold(sheet.ids[0]!, when)
            else mailbox.hold(sheet.ids, when)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'register' && (
        <RegisterSheet
          onPick={(days) => {
            if (days) void mailbox.register(sheet.threadId, sheet.messageId, days)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'rules' && <RulesSheet from={sheet.from} labelId={sheet.labelId} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'person' && <SenderCard contact={sheet.contact} onClose={() => setSheet(null)} onRules={(from) => setSheet({ kind: 'rules', from })} />}
      {sheet?.kind === 'album' && <StampAlbum onClose={() => setSheet(null)} onPerson={(contact) => setSheet({ kind: 'person', contact })} />}
      {sheet?.kind === 'spike' && <SpikeSheet onClose={() => setSheet(null)} />}
      <Toasts />
    </div>
  )
}
