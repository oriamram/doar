import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { isEmail, parseAddressList, shortName, uniqueContacts } from '../lib/addresses'
import { buildRaw, filesToAttachments, isBlank, sanitizeForEditor } from '../lib/compose'
import { rememberContacts, suggestContacts } from '../lib/contacts'
import { formatBytes, formatWhen } from '../lib/format'
import { saveDraft } from '../lib/gmail'
import { useBackLayer } from '../lib/layers'
import { mailbox, useMailbox } from '../lib/mailbox'
import { stampColor, stampLetter } from '../lib/stamps'
import { toast } from '../lib/toast'
import type { ComposeAttachment, ComposeDraft, Contact } from '../types'
import { ClipIcon, ClockIcon, CloseIcon, ListIcon, SendIcon, TrashIcon } from './icons'
import { ScheduleSheet } from './Sheets'

const TITLES: Record<ComposeDraft['mode'], string> = {
  new: 'מכתב חדש',
  reply: 'תשובה',
  replyAll: 'תשובה לכולם',
  forward: 'העברה',
  draft: 'טיוטה',
}

const STATUS = { idle: '', saving: 'שומרים…', saved: 'הטיוטה נשמרה', error: 'לא נשמר' }

/** Gmail's limit for one email is 25MB; base64 makes files a third bigger on the way. */
const MAX_BYTES = 18 * 1024 * 1024

const stampStyle = (contact: Contact) => ({ '--stamp': stampColor(contact) }) as CSSProperties

type RecipientsProps = {
  no: string
  label: string
  value: Contact[]
  onChange: (next: Contact[]) => void
  autoFocus?: boolean
  trailing?: ReactNode
}

/** A "To" box: addresses become chips; typing suggests people you've written with. */
function Recipients({ no, label, value, onChange, autoFocus, trailing }: RecipientsProps) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const suggestions = focused && text.trim() ? suggestContacts(text, value) : []
  const leftover = !focused && text.trim() !== ''

  const add = (contacts: Contact[]) => {
    onChange(uniqueContacts([...value, ...contacts]))
    setText('')
    setActive(0)
  }

  /** Turn what's typed into chips, if it holds at least one address. */
  const commit = () => {
    const parsed = parseAddressList(text)
    if (parsed.length) add(parsed)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const typed = text.trim()
    const pick = suggestions[active]
    if (e.key === 'Enter' || (e.key === 'Tab' && typed)) {
      // Enter never sends the letter from here; it picks the suggestion or keeps the address.
      if (e.key === 'Enter' || pick) e.preventDefault()
      if (pick) add([pick])
      else commit()
    } else if ((e.key === ',' || e.key === ';' || e.key === ' ') && isEmail(typed)) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    } else if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault()
      setActive((index) => Math.min(index + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseAddressList(e.clipboardData.getData('text/plain'))
    if (parsed.length === 0) return
    e.preventDefault()
    add(parsed)
  }

  return (
    <div className="field" data-invalid={leftover || undefined}>
      <label className="field-label" htmlFor={id}>
        <span className="field-no">{no}</span>
        {label}
      </label>
      <div className="recipients" onClick={() => input.current?.focus()}>
        {value.map((contact) => (
          <span key={contact.email} className="chip" title={contact.email}>
            <span className="chip-stamp" style={stampStyle(contact)} aria-hidden="true">
              {stampLetter(contact.name || contact.email)}
            </span>
            <span className="chip-name ellipsis" dir="auto">
              {shortName(contact)}
            </span>
            <button type="button" aria-label={`הסרת ${shortName(contact)}`} onClick={() => onChange(value.filter((other) => other !== contact))}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          className="recipient-input"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="next"
          dir="auto"
          value={text}
          autoFocus={autoFocus}
          aria-invalid={leftover || undefined}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
        />
        {trailing}
      </div>
      {leftover && <p className="field-note">זו לא כתובת מייל תקינה.</p>}
      {suggestions.length > 0 && (
        <ul className="suggestions" role="listbox" aria-label="הצעות">
          {suggestions.map((contact, index) => (
            <li
              key={contact.email}
              role="option"
              aria-selected={index === active}
              // Keep the keyboard focus in the box, so picking doesn't close the list first.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => add([contact])}
            >
              <span className="chip-stamp" style={stampStyle(contact)} aria-hidden="true">
                {stampLetter(contact.name || contact.email)}
              </span>
              <span className="suggest-name ellipsis" dir="auto">
                {shortName(contact)}
              </span>
              <span className="suggest-email ellipsis" dir="ltr">
                {contact.email}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Writing an email, on a telegram form. It saves itself to Gmail's Drafts as you type. */
export function Compose({ initial }: { initial: ComposeDraft }) {
  const { me, scheduled } = useMailbox()
  // This letter already waits for a time (it was opened from "scheduled").
  const waiting = scheduled.find((item) => item.draftId === initial.draftId && item.status !== 'failed')
  const [scheduling, setScheduling] = useState(false)
  const [to, setTo] = useState(initial.to)
  const [cc, setCc] = useState(initial.cc)
  const [bcc, setBcc] = useState(initial.bcc)
  const [showCopies, setShowCopies] = useState(initial.cc.length + initial.bcc.length > 0)
  const [subject, setSubject] = useState(initial.subject)
  const [attachments, setAttachments] = useState<ComposeAttachment[]>(initial.attachments)
  const [includeQuote, setIncludeQuote] = useState(initial.quote?.include ?? false)
  const [status, setStatus] = useState<keyof typeof STATUS>(initial.draftId ? 'saved' : 'idle')
  const [words, setWords] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [dragging, setDragging] = useState(false)
  const editor = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const bodyLabel = useId()
  // Set once: React must never rewrite the editor's content while you type in it.
  const [startHtml] = useState(() => ({ __html: sanitizeForEditor(initial.html) }))
  const [serial] = useState(() => String(Date.now() % 1_000_000).padStart(6, '0'))

  const snapshot = (draftId?: string): ComposeDraft => ({
    ...initial,
    draftId,
    to,
    cc,
    bcc,
    subject,
    html: editor.current?.innerHTML ?? '',
    quote: initial.quote ? { ...initial.quote, include: includeQuote } : undefined,
    attachments,
  })
  // Saving runs on a timer, so it reads the form through a ref that always holds the latest fields.
  const latest = useRef(snapshot)
  useLayoutEffect(() => {
    latest.current = snapshot
  })

  const saver = useRef({
    draftId: initial.draftId,
    dirty: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    running: null as Promise<void> | null,
  })

  /** Save to Drafts now, if anything changed. Resolves to false when saving failed. */
  const save = async (): Promise<boolean> => {
    const state = saver.current
    clearTimeout(state.timer)
    while (state.running) await state.running
    if (!state.dirty) return true
    const draft = latest.current(state.draftId)
    const text = editor.current?.innerText ?? ''
    state.dirty = false
    // Nothing written yet: don't leave an empty draft behind.
    if (!state.draftId && isBlank(draft, text)) return true
    setStatus('saving')
    let saved = true
    state.running = (async () => {
      try {
        const result = await saveDraft(await buildRaw(draft, text, me), draft.threadId, state.draftId)
        state.draftId = result.id
        setStatus(state.dirty ? 'idle' : 'saved')
      } catch {
        state.dirty = true
        saved = false
        setStatus('error')
      }
    })()
    await state.running
    state.running = null
    return saved
  }

  /** Something changed: save shortly after the typing stops. */
  const touch = () => {
    const state = saver.current
    state.dirty = true
    setProblem('')
    clearTimeout(state.timer)
    state.timer = setTimeout(() => void save(), 2000)
  }

  useEffect(() => {
    const state = saver.current
    return () => clearTimeout(state.timer)
  }, [])

  // A reply starts in the letter itself; a new letter starts at "To".
  useEffect(() => {
    if (initial.to.length > 0) editor.current?.focus()
  }, [initial.to.length])

  const close = async () => {
    if (busy) return
    setBusy(true)
    const saved = await save()
    const { draftId } = saver.current
    mailbox.closeCompose(initial.threadId)
    if (!saved) toast('לא הצלחנו לשמור את הטיוטה. בדקו את החיבור.', { tone: 'error' })
    else if (waiting) toast(`המכתב נשמר, ויישלח ${formatWhen(waiting.sendAt)}`)
    else if (draftId) toast('המכתב נשמר בטיוטות')
  }
  useBackLayer(true, () => void close())

  const discard = async () => {
    if (busy) return
    setBusy(true)
    const state = saver.current
    clearTimeout(state.timer)
    state.dirty = false
    while (state.running) await state.running
    void mailbox.discardDraft(state.draftId, initial.threadId)
  }

  /** Is there someone to send to? (An address still being typed counts once its box loses focus.) */
  const hasRecipient = async (): Promise<boolean> => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const draft = latest.current()
    if (draft.to.length + draft.cc.length + draft.bcc.length > 0) return true
    setProblem('למי לשלוח? הוסיפו לפחות נמען אחד.')
    return false
  }

  /** Save the letter as it is now, ready to leave. Null (with the reason on screen) if it can't. */
  const ready = async (): Promise<(ComposeDraft & { draftId: string }) | null> => {
    if (busy || !(await hasRecipient())) return null
    setBusy(true)
    saver.current.dirty = true
    const saved = await save()
    const { draftId } = saver.current
    if (!saved || !draftId) {
      setBusy(false)
      setProblem('לא הצלחנו לשמור את המכתב, ולכן הוא לא נשלח. בדקו את החיבור ונסו שוב.')
      return null
    }
    const draft = latest.current(draftId)
    rememberContacts([...draft.to, ...draft.cc, ...draft.bcc], 3)
    return { ...draft, draftId }
  }

  const send = async () => {
    const draft = await ready()
    if (draft) mailbox.send(draft)
  }

  const sendLater = async (when: Date) => {
    const draft = await ready()
    if (draft) void mailbox.schedule(draft, when)
  }

  const chooseTime = async () => {
    if (!busy && (await hasRecipient())) setScheduling(true)
  }

  const addFiles = (files: Iterable<File>) => {
    const added = filesToAttachments(files)
    if (added.length === 0) return
    const total = [...attachments, ...added].reduce((sum, file) => sum + file.size, 0)
    if (total > MAX_BYTES) {
      toast('הקבצים גדולים מדי למכתב אחד (עד 18MB בסך הכל).', { tone: 'error' })
      return
    }
    setAttachments([...attachments, ...added])
    touch()
  }

  const format = (command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList') => {
    editor.current?.focus()
    document.execCommand(command)
    touch()
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.clipboardData.files.length) {
      addFiles(e.clipboardData.files)
      return
    }
    // Pasted text arrives plain: no stray fonts, colors or hidden markup.
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // The time sheet is open on top; its keys are its own.
    if (scheduling) return
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      void close()
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value)
      touch()
    }

  return (
    <div
      className="compose"
      role="dialog"
      aria-label={TITLES[initial.mode]}
      data-dragging={dragging || undefined}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="compose-bar">
        <button className="icon-btn" onClick={() => void close()} aria-label="סגירה ושמירה בטיוטות" title="סגירה ושמירה בטיוטות">
          <CloseIcon />
        </button>
        <span className="compose-title">{TITLES[initial.mode]}</span>
        <span className="compose-status" data-state={status} aria-live="polite">
          {STATUS[status]}
        </span>
        <button className="icon-btn" onClick={() => void discard()} aria-label="מחיקת הטיוטה" title="מחיקת הטיוטה">
          <TrashIcon />
        </button>
      </header>

      <form
        className="telegram"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="telegram-head">
          <div className="telegram-title">
            <span className="form-no">טופס 11 · שירות המברקים</span>
            <strong>מברק</strong>
          </div>
          <span className="telegram-serial" dir="ltr">
            No. {serial}
          </span>
        </div>

        <Recipients
          no="01"
          label="אל"
          value={to}
          onChange={edit(setTo)}
          autoFocus={initial.to.length === 0}
          trailing={
            !showCopies && (
              <button type="button" className="link-btn" onClick={() => setShowCopies(true)}>
                עותקים
              </button>
            )
          }
        />
        {showCopies && (
          <>
            <Recipients no="01א" label="עותק" value={cc} onChange={edit(setCc)} />
            <Recipients no="01ב" label="עותק מוסתר" value={bcc} onChange={edit(setBcc)} />
          </>
        )}

        <div className="field">
          <label className="field-label" htmlFor={`${bodyLabel}-subject`}>
            <span className="field-no">02</span>
            נושא
          </label>
          <input
            id={`${bodyLabel}-subject`}
            className="field-input"
            dir="auto"
            value={subject}
            enterKeyHint="next"
            onChange={(e) => edit(setSubject)(e.target.value)}
            onKeyDown={(e) => {
              // Enter moves on to the letter instead of sending it.
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                editor.current?.focus()
              }
            }}
          />
        </div>

        <div className="field field-body">
          <span className="field-label" id={bodyLabel}>
            <span className="field-no">03</span>
            תוכן המברק
          </span>
          <div
            ref={editor}
            className="editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-labelledby={bodyLabel}
            dir="auto"
            spellCheck
            dangerouslySetInnerHTML={startHtml}
            onInput={() => {
              touch()
              setWords((editor.current?.innerText.match(/\S+/g) ?? []).length)
            }}
            onPaste={onPaste}
          />
        </div>

        {initial.quote && (
          <label className="check quote-toggle">
            <input
              type="checkbox"
              checked={includeQuote}
              onChange={(e) => {
                setIncludeQuote(e.target.checked)
                touch()
              }}
            />
            <span>{initial.mode === 'forward' ? 'לצרף את המכתב שמועבר' : 'לצרף את המכתב המקורי מתחת לתשובה'}</span>
          </label>
        )}

        {attachments.length > 0 && (
          <ul className="compose-files">
            {attachments.map((file) => (
              <li key={file.key} className="file-chip">
                <ClipIcon />
                <span className="file-name ellipsis" dir="auto">
                  {file.filename}
                </span>
                <span className="file-size">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`הסרת ${file.filename}`}
                  onClick={() => {
                    setAttachments(attachments.filter((other) => other !== file))
                    touch()
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {problem && (
          <p className="compose-problem" role="alert">
            {problem}
          </p>
        )}

        {waiting && (
          <p className="scheduled-note">
            <ClockIcon />
            <span>יישלח {formatWhen(waiting.sendAt)}</span>
            <button type="button" onClick={() => setScheduling(true)}>
              שינוי
            </button>
            <button type="button" onClick={() => void mailbox.unschedule(waiting.id)}>
              ביטול התזמון
            </button>
          </p>
        )}

        <footer className="telegram-foot">
          <div className="format-bar" role="toolbar" aria-label="עיצוב">
            {/* Keep the cursor in the letter while pressing these. */}
            <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => format('bold')} aria-label="מודגש" title="מודגש (Ctrl+B)">
              <b>B</b>
            </button>
            <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => format('italic')} aria-label="נטוי" title="נטוי (Ctrl+I)">
              <i>I</i>
            </button>
            <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => format('underline')} aria-label="קו תחתון" title="קו תחתון (Ctrl+U)">
              <u>U</u>
            </button>
            <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => format('insertUnorderedList')} aria-label="רשימה" title="רשימה">
              <ListIcon />
            </button>
            <button type="button" className="attach-btn" onClick={() => fileInput.current?.click()} aria-label="צירוף קובץ" title="צירוף קובץ">
              <ClipIcon />
            </button>
          </div>
          <span className="word-count">מילים: {words}</span>
          <button
            type="button"
            className="later-btn"
            onClick={() => void chooseTime()}
            disabled={busy}
            aria-label="שליחה מאוחר יותר"
            title="שליחה מאוחר יותר"
          >
            <ClockIcon />
          </button>
          <button type="submit" className="send-stamp" disabled={busy} title={waiting ? 'שליחה עכשיו (Ctrl+Enter)' : 'שליחה (Ctrl+Enter)'}>
            <span className="stamp" data-size="lg" aria-hidden="true">
              <span className="stamp-paper">
                <span className="stamp-face">
                  <SendIcon />
                </span>
              </span>
            </span>
            <span className="send-word">שליחה</span>
          </button>
        </footer>
      </form>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {dragging && <div className="drop-note">שחררו כאן כדי לצרף</div>}
      {scheduling && (
        <ScheduleSheet
          current={waiting?.sendAt}
          onPick={(when) => {
            setScheduling(false)
            void sendLater(when)
          }}
          onClose={() => setScheduling(false)}
        />
      )}
    </div>
  )
}
