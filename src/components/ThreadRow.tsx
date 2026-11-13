import { memo, useRef, type DragEvent, type MouseEvent, type PointerEvent } from 'react'
import { shortName } from '../lib/addresses'
import { canDrag, DRAG_TYPE } from '../lib/dragging'
import { formatListDate } from '../lib/format'
import type { Shape } from '../lib/kinds'
import { mailbox } from '../lib/mailbox'
import type { Reminder } from '../lib/postman'
import { isFolder, type View } from '../lib/views'
import type { Label, Thread } from '../types'
import { ArchiveIcon, CheckIcon, HoldIcon, MailIcon, MailOpenIcon, RestoreIcon, TrashIcon } from './icons'
import { CodeCopy, KindLine, KindTag } from './Kinds'
import { GoldStar, LabelTape, Paperclip, ReminderSlip, SenderStamp } from './Postal'
import { SwipeRow, type SwipeAction } from './SwipeRow'

type Props = {
  thread: Thread
  view: View
  labels: Label[]
  selected: boolean
  /** Some letters are selected: a tap selects instead of opening. */
  selecting: boolean
  current: boolean
  arrived: boolean
  /** Doar's server is keeping time for this letter: held, registered, or just back. */
  reminder?: Reminder
  /** Its sender is marked "express". */
  express?: boolean
  /** What kind of mail it is: a code, a parcel, a receipt, an invitation, a leaflet, or a letter. */
  shape: Shape
  /** You wrote a note on it. */
  noted?: boolean
  /** Ask when to bring these letters back (opens the held-mail form). */
  onHold: (ids: string[]) => void
  /** A right click (PC): open the letter's menu at this point of the screen. */
  onMenu: (thread: Thread, x: number, y: number) => void
}

/** What swiping this letter does, depending on where it is. */
function swipes(thread: Thread, view: View): { left?: SwipeAction; right?: SwipeAction } {
  const ids = [thread.id]
  const read: SwipeAction = {
    label: thread.unread ? 'נקרא' : 'לא נקרא',
    run: () => mailbox.setRead(ids, thread.unread),
  }
  if (isFolder(view, 'trash')) return { left: { label: 'שוחזר', run: () => mailbox.untrash(ids) } }
  if (isFolder(view, 'spam')) return { left: { label: 'לא ספאם', run: () => mailbox.notSpam(ids) } }
  if (isFolder(view, 'drafts') || isFolder(view, 'waiting')) return {}
  if (isFolder(view, 'held')) return { left: { label: 'חזר לדואר הנכנס', run: () => void mailbox.bringBack(thread.id) } }
  if (isFolder(view, 'archive')) return { left: { label: 'לדואר הנכנס', run: () => mailbox.moveToInbox(ids) }, right: read }
  if (thread.labelIds.includes('INBOX')) return { left: { label: 'תויק', run: () => mailbox.archive(ids) }, right: read }
  return { right: read }
}

/** Touch and hold (phones): calls `onHold` once, and reports it so the tap that follows is ignored. */
function useHold(onHold: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const origin = useRef({ x: 0, y: 0 })
  const held = useRef(false)
  const touch = useRef(false)
  const cancel = () => clearTimeout(timer.current)
  return {
    /** True once, right after a hold: the tap that ends the hold should do nothing more. */
    wasHeld: () => {
      const was = held.current
      held.current = false
      return was
    },
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        held.current = false
        touch.current = e.pointerType === 'touch'
        if (!touch.current) return
        origin.current = { x: e.clientX, y: e.clientY }
        timer.current = setTimeout(() => {
          held.current = true
          onHold()
        }, 480)
      },
      onPointerMove: (e: PointerEvent) => {
        if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 9) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      // Holding a finger down also asks for the browser's menu; we used the hold ourselves.
      onContextMenu: (e: MouseEvent) => {
        if (touch.current) e.preventDefault()
      },
    },
  }
}

export const ThreadRow = memo(function ThreadRow({ thread, view, labels, selected, selecting, current, arrived, reminder, express, shape, noted, onHold, onMenu }: Props) {
  const hold = useHold(() => mailbox.toggleSelect(thread.id))
  const ids = [thread.id]
  const person = shortName(thread.from)
  const name = thread.outgoing ? (person ? `אל: ${person}` : '(ללא נמען)') : person
  const tapes = labels.filter((label) => thread.labelIds.includes(label.id))
  const inTrash = isFolder(view, 'trash')
  const inSpam = isFolder(view, 'spam')

  // With a mouse, a letter is dragged onto a folder, a label or the bin; selected letters go together.
  const drag = (event: DragEvent) => {
    const picked = mailbox.state().selection
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(picked.has(thread.id) ? [...picked] : [thread.id]))
    event.dataTransfer.effectAllowed = 'move'
  }
  const menu = (event: MouseEvent) => {
    // A finger held down selects (see useHold); the menu is for the mouse's right button.
    if ((event.nativeEvent as globalThis.PointerEvent).pointerType === 'touch' || !canDrag) return
    event.preventDefault()
    onMenu(thread, event.clientX, event.clientY)
  }

  const open = () => {
    if (hold.wasHeld()) return
    if (selecting) mailbox.toggleSelect(thread.id)
    else mailbox.open(thread)
  }

  return (
    <SwipeRow {...swipes(thread, view)} disabled={selecting}>
      <div
        className="thread-row"
        data-kind={shape.kind === 'letter' ? undefined : shape.kind}
        data-unread={thread.unread || undefined}
        data-selected={selected || undefined}
        data-arrived={arrived || undefined}
        aria-current={current || undefined}
        draggable={canDrag || undefined}
        onDragStart={canDrag ? drag : undefined}
        onContextMenu={menu}
      >
        <button
          type="button"
          className="row-pick"
          aria-pressed={selected}
          aria-label={`${selected ? 'ביטול הבחירה' : 'בחירה'}: ${name}`}
          onClick={() => mailbox.toggleSelect(thread.id)}
        >
          {selected ? (
            <span className="pick-seal">
              <CheckIcon />
            </span>
          ) : (
            <SenderStamp contact={thread.from} used={!thread.unread} />
          )}
        </button>

        <button type="button" className="row-open" onClick={open} {...hold.handlers}>
          <span className="thread-top">
            {thread.hasDraft && <span className="draft-mark">טיוטה</span>}
            <span className="sender ellipsis" dir="auto">
              {name}
            </span>
            {express && <span className="express-mark">אקספרס</span>}
            {shape.kind === 'invitation' && <KindTag shape={shape} />}
            {thread.messageCount > 1 && (
              <span className="msg-count" title={`${thread.messageCount} הודעות בשיחה`}>
                {thread.messageCount}
              </span>
            )}
            {thread.starred && (
              <>
                <GoldStar className="star-mark" />
                <span className="visually-hidden">מסומן בכוכב, </span>
              </>
            )}
            <span className="row-date">
              <span className="visually-hidden">{thread.unread ? 'לא נקרא, ' : 'נקרא, '}</span>
              {formatListDate(thread.date)}
            </span>
          </span>
          <span className="subject ellipsis" dir="auto">
            {thread.subject}
          </span>
          <span className="row-bottom">
            {shape.kind === 'code' || shape.kind === 'parcel' ? (
              <KindLine shape={shape} date={thread.date} />
            ) : (
              <span className="snippet ellipsis" dir="auto">
                {thread.snippet}
              </span>
            )}
            {shape.kind === 'receipt' && <KindTag shape={shape} />}
            {tapes.slice(0, 2).map((label) => (
              <LabelTape key={label.id} label={label} />
            ))}
            {tapes.length > 2 && <span className="tape-more">+{tapes.length - 2}</span>}
          </span>
          {reminder && <ReminderSlip reminder={reminder} />}
        </button>

        {thread.hasAttachment && <Paperclip />}
        {noted && <span className="note-corner" role="img" aria-label="יש פתק" title="יש פתק על המכתב הזה" />}
        {shape.kind === 'code' && !selecting && <CodeCopy code={shape.code} />}

        {/* Quick actions for a mouse; phones swipe instead. */}
        <span className="row-actions">
          {inTrash || inSpam ? (
            <button
              type="button"
              title={inTrash ? 'שחזור מהאשפה' : 'לא ספאם'}
              aria-label={inTrash ? 'שחזור מהאשפה' : 'לא ספאם'}
              onClick={() => (inTrash ? mailbox.untrash(ids) : mailbox.notSpam(ids))}
            >
              <RestoreIcon />
            </button>
          ) : (
            <>
              {thread.labelIds.includes('INBOX') && (
                <button type="button" title="תיוק" aria-label="תיוק" onClick={() => mailbox.archive(ids)}>
                  <ArchiveIcon />
                </button>
              )}
              {thread.labelIds.includes('INBOX') && (
                <button type="button" title="להחזיר אליי במועד אחר" aria-label="להחזיר אליי במועד אחר" onClick={() => onHold(ids)}>
                  <HoldIcon />
                </button>
              )}
              <button type="button" title="מחיקה" aria-label="מחיקה" onClick={() => mailbox.trash(ids)}>
                <TrashIcon />
              </button>
              <button
                type="button"
                title={thread.unread ? 'סימון כנקרא' : 'סימון כלא נקרא'}
                aria-label={thread.unread ? 'סימון כנקרא' : 'סימון כלא נקרא'}
                onClick={() => mailbox.setRead(ids, thread.unread)}
              >
                {thread.unread ? <MailOpenIcon /> : <MailIcon />}
              </button>
            </>
          )}
        </span>
      </div>
    </SwipeRow>
  )
})
