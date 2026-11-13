import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { formatAgo, formatWhen, schedulePresets, toFieldTime } from '../lib/format'
import { promptInstall, useInstall } from '../lib/install'
import { useBackLayer } from '../lib/layers'
import { mailbox, useMailbox } from '../lib/mailbox'
import type { NotifyScope } from '../lib/postman'
import { disablePush, enablePush, setPushScope, testPush, usePush } from '../lib/push'
import { APP_VERSION, reportNow } from '../lib/report'
import { updateSettings, useSettings, type Settings } from '../lib/settings'
import { playSound } from '../lib/sound'
import { toast } from '../lib/toast'
import { labelLeaf } from '../lib/views'
import type { Thread } from '../types'
import { CloseIcon, InstallIcon, LogoutIcon } from './icons'
import { LabelTape } from './Postal'

type SheetProps = {
  title: string
  /** The form number printed above the title ("טופס 7"). */
  form: string
  onClose: () => void
  children: ReactNode
}

/** A paper form laid over the desk: slides up on phones, sits in the middle on wide screens. */
export function Sheet({ title, form, onClose, children }: SheetProps) {
  useBackLayer(true, onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sheet-backdrop" aria-label="סגירה" onClick={onClose} />
      <div className="sheet">
        <header className="sheet-head">
          <div>
            <span className="form-no">{form}</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה">
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

type CheckProps = { checked: boolean; onChange: (checked: boolean) => void; title: string; note?: string; disabled?: boolean }

/** A form checkbox, ticked in red ink. */
function Check({ checked, onChange, title, note, disabled }: CheckProps) {
  return (
    <label className="check setting" data-disabled={disabled || undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="setting-title">{title}</span>
        {note && <span className="setting-note">{note}</span>}
      </span>
    </label>
  )
}

const THEMES: { id: Settings['theme']; label: string }[] = [
  { id: 'auto', label: 'לפי המכשיר' },
  { id: 'light', label: 'יום' },
  { id: 'dark', label: 'לילה' },
]

const UNDO_TIMES = [
  { seconds: 0, label: 'בלי' },
  { seconds: 5, label: '5 שניות' },
  { seconds: 10, label: '10 שניות' },
  { seconds: 20, label: '20 שניות' },
]

const SCOPES: { id: NotifyScope; label: string }[] = [
  { id: 'all', label: 'הכל' },
  { id: 'important', label: 'בלי פרסומות' },
  { id: 'primary', label: 'רק אישיים' },
]

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings()
  const { me, server } = useMailbox()
  const push = usePush()
  const install = useInstall()
  const [reporting, setReporting] = useState(false)

  const sendReport = async () => {
    setReporting(true)
    const sent = await reportNow()
    setReporting(false)
    if (sent) toast('הדוח נשלח. תודה.')
    else toast('הדוח לא נשלח. בדקו את החיבור ונסו שוב.', { tone: 'error' })
  }

  const setNotifications = async (on: boolean) => {
    if (!on) {
      await disablePush()
      toast('ההתראות כובו במכשיר הזה.')
      return
    }
    const result = await enablePush()
    if (result === 'on') toast('ההתראות הופעלו במכשיר הזה.')
    else if (result === 'blocked') toast('ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות האתר (המנעול שליד הכתובת).', { tone: 'error' })
    else if (result === 'broken') toast('הדפדפן הזה לא מקבל התראות. נסו ב־Chrome.', { tone: 'error' })
    else if (result === 'unsupported') toast('אי אפשר להפעיל התראות בדפדפן הזה.', { tone: 'error' })
    else toast('לא הצלחנו להפעיל התראות. בדקו את החיבור ונסו שוב.', { tone: 'error' })
  }

  const sendTest = async () => {
    try {
      const { sent, total } = await testPush()
      if (total === 0) toast('אין מכשיר שמקבל התראות. הפעילו אותן קודם.', { tone: 'error' })
      else if (sent === total) toast(total === 1 ? 'התראת ניסיון נשלחה למכשיר אחד.' : `התראת ניסיון נשלחה ל־${total} מכשירים.`)
      else toast(`התראת הניסיון התקבלה רק ב־${sent} מתוך ${total} מכשירים.`, { tone: 'error' })
    } catch {
      toast('אין קשר עם השרת של דואר כרגע. נסו שוב.', { tone: 'error' })
    }
  }

  return (
    <Sheet title="הגדרות" form="טופס 7 · העדפות הלקוח" onClose={onClose}>
      <fieldset className="setting-group">
        <legend>התראות על דואר חדש</legend>
        {!push.supported ? (
          <p className="setting-note">הדפדפן הזה לא יכול לקבל התראות.</p>
        ) : push.broken ? (
          <p className="setting-note">
            הדפדפן הזה (Edge בטלפון) לא מקבל התראות מאתרים. פתחו את דואר ב־Chrome, התקינו אותו משם והפעילו שם את ההתראות.
          </p>
        ) : (
          <Check
            checked={push.on}
            disabled={push.busy}
            onChange={(on) => void setNotifications(on)}
            title="התראות במכשיר הזה"
            note={
              push.permission === 'denied'
                ? 'ההתראות חסומות בדפדפן. מאשרים אותן בהגדרות האתר (המנעול שליד הכתובת).'
                : 'גם כשדואר סגור: שם השולח והנושא, תוך דקה. כל מכשיר מופעל בנפרד.'
            }
          />
        )}
        {push.devices > 0 && (
          <>
            <div className="setting">
              <span className="setting-title" id="scope-label">
                על אילו מכתבים
              </span>
              <div className="segments" role="radiogroup" aria-labelledby="scope-label">
                {SCOPES.map((scope) => (
                  <button
                    key={scope.id}
                    role="radio"
                    aria-checked={push.scope === scope.id}
                    onClick={() => void setPushScope(scope.id).catch(() => toast('ההגדרה לא נשמרה. נסו שוב.', { tone: 'error' }))}
                  >
                    {scope.label}
                  </button>
                ))}
              </div>
              <span className="setting-note">„בלי פרסומות” משאיר גם עדכונים, כמו קבלות וקודי אימות.</span>
            </div>
            <div className="setting">
              <button className="pill-btn" onClick={() => void sendTest()}>
                שליחת התראת ניסיון
              </button>
              <span className="setting-note">
                {push.devices === 1 ? 'מכשיר אחד מקבל התראות.' : `${push.devices} מכשירים מקבלים התראות.`}
              </span>
            </div>
          </>
        )}
      </fieldset>

      {!install.installed && (
        <fieldset className="setting-group">
          <legend>אפליקציה</legend>
          <div className="setting">
            {install.available ? (
              <button className="pill-btn" onClick={() => void promptInstall()}>
                <InstallIcon />
                התקנת דואר במכשיר הזה
              </button>
            ) : (
              <span className="setting-note">
                כדי שדואר ייפתח כאפליקציה משלו: בתפריט הדפדפן בוחרים „התקנת האפליקציה” או „הוספה למסך הבית”. בטלפון עושים את זה ב־Chrome.
              </span>
            )}
          </div>
        </fieldset>
      )}

      <fieldset className="setting-group">
        <legend>מראה</legend>
        <div className="segments" role="radiogroup" aria-label="מראה">
          {THEMES.map((theme) => (
            <button key={theme.id} role="radio" aria-checked={settings.theme === theme.id} onClick={() => updateSettings({ theme: theme.id })}>
              {theme.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="setting-group">
        <legend>דואר נכנס</legend>
        <Check
          checked={settings.bundles}
          onChange={(bundles) => {
            updateSettings({ bundles })
            mailbox.settingsChanged()
          }}
          title="צרורות"
          note="עדכונים, פרסומות ורשתות חברתיות נקשרים לצרור אחד, והמכתבים האישיים נשארים בחוץ."
        />
        <Check
          checked={settings.remoteImages}
          onChange={(remoteImages) => updateSettings({ remoteImages })}
          title="להציג תמונות במכתבים"
          note="כשזה כבוי, תמונות מהאינטרנט מוסתרות עד שמבקשים, והשולח לא יודע שפתחתם."
        />
      </fieldset>

      <fieldset className="setting-group">
        <legend>כתיבה</legend>
        <div className="setting">
          <span className="setting-title" id="undo-label">
            אפשרות לבטל שליחה
          </span>
          <div className="segments" role="radiogroup" aria-labelledby="undo-label">
            {UNDO_TIMES.map((time) => (
              <button
                key={time.seconds}
                role="radio"
                aria-checked={settings.undoSendSeconds === time.seconds}
                onClick={() => updateSettings({ undoSendSeconds: time.seconds })}
              >
                {time.label}
              </button>
            ))}
          </div>
        </div>
        <label className="setting">
          <span className="setting-title">חתימה</span>
          <textarea
            className="signature"
            rows={3}
            dir="auto"
            placeholder="מתווספת בסוף כל מכתב חדש"
            value={settings.signature}
            onChange={(e) => updateSettings({ signature: e.target.value })}
          />
        </label>
      </fieldset>

      <fieldset className="setting-group">
        <legend>צלילים</legend>
        <Check
          checked={settings.sounds}
          onChange={(sounds) => {
            updateSettings({ sounds })
            if (sounds) playSound('thump')
          }}
          title="צלילי שולחן"
          note="חותמת, נייר ומכתב שעף."
        />
      </fieldset>

      <fieldset className="setting-group">
        <legend>מצב המערכת</legend>
        <dl className="status-list">
          <div>
            <dt>גרסה</dt>
            <dd dir="ltr">{APP_VERSION}</dd>
          </div>
          <div>
            <dt>השרת של דואר</dt>
            <dd>
              {!server
                ? 'עוד לא ענה'
                : !server.reachable
                  ? 'אין קשר כרגע'
                  : server.lookedAt
                    ? `בדק דואר ${formatAgo(server.lookedAt)}`
                    : 'פועל. הוא בודק דואר כשההתראות או התיוג האוטומטי פועלים'}
            </dd>
          </div>
          {server?.devices.map((device, index) => (
            <div key={index}>
              <dt>{device.device || 'מכשיר'}</dt>
              <dd>{device.lastOkAt ? `קיבל התראה ${formatAgo(device.lastOkAt)}` : 'עוד לא קיבל התראה'}</dd>
            </div>
          ))}
          {server?.lastReport && (
            <div>
              <dt>תקלה אחרונה</dt>
              <dd>
                {formatAgo(server.lastReport.at)} · <span dir="ltr">{server.lastReport.place}</span>
              </dd>
            </div>
          )}
        </dl>
        <div className="setting">
          <button className="pill-btn" disabled={reporting} onClick={() => void sendReport()}>
            {reporting ? 'שולחים…' : 'שליחת דוח תקלה'}
          </button>
          <span className="setting-note">
            משהו לא עובד? הדוח מספר איזה מכשיר ודפדפן אלה, ומה השגיאות האחרונות שקרו בהם. אין בו תוכן של מכתבים.
          </span>
        </div>
      </fieldset>

      <fieldset className="setting-group">
        <legend>חשבון</legend>
        <div className="setting account-setting">
          <span className="account-email" dir="ltr">
            {me.email}
          </span>
          <button className="pill-btn" onClick={mailbox.signOut}>
            <LogoutIcon />
            התנתקות
          </button>
        </div>
        <div className="setting">
          <span className="setting-note">
            התנתקות מנתקת רק את המכשיר הזה. שאר המכשירים שלך, ההתראות אליהם, המכתבים המתוזמנים והתיוג האוטומטי ממשיכים לעבוד.
          </span>
          <button type="button" className="erase-link" onClick={() => void mailbox.forgetEverything()}>
            ניתוק מכל המכשירים ומחיקת הנתונים מהשרת של דואר
          </button>
        </div>
      </fieldset>
    </Sheet>
  )
}

/** Put your labels on letters, or take them off. */
type LabelSheetProps = {
  ids: string[]
  onClose: () => void
  /** Open the automatic-label form for this sender, with this label already chosen. */
  onRules: (from: string, labelId?: string) => void
}

export function LabelSheet({ ids, onClose, onRules }: LabelSheetProps) {
  const { labels, threads, open, bundles } = useMailbox()
  const [name, setName] = useState('')
  const everything: Thread[] = [...(threads ?? []), ...bundles.flatMap((bundle) => bundle.threads), ...(open ? [open] : [])]
  const chosen = ids.map((id) => everything.find((thread) => thread.id === id)).filter((thread) => thread !== undefined)
  // One letter from someone else: its sender can get these labels every time.
  const only = chosen.length === 1 && !chosen[0]!.outgoing ? chosen[0]! : null
  const worn = only ? labels.filter((label) => only.labelIds.includes(label.id)) : []

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const label = await mailbox.addLabel(name)
    if (!label) return
    mailbox.setLabel(ids, label.id, true)
    setName('')
  }

  return (
    <Sheet title="תוויות" form="טופס 4 · סימון דברי דואר" onClose={onClose}>
      {labels.length === 0 && <p className="muted">עוד אין תוויות. אפשר ליצור אחת כאן למטה.</p>}
      <div className="label-list">
        {labels.map((label) => {
          const count = chosen.filter((thread) => thread.labelIds.includes(label.id)).length
          const all = count === chosen.length && count > 0
          return (
            <label key={label.id} className="check label-row" data-depth={Math.min(label.name.split('/').length - 1, 2) || undefined}>
              <input
                type="checkbox"
                checked={all}
                ref={(input) => {
                  if (input) input.indeterminate = count > 0 && !all
                }}
                onChange={() => mailbox.setLabel(ids, label.id, !all)}
              />
              <LabelTape label={label} />
              {label.name.includes('/') && <span className="label-path">{label.name.split('/').slice(0, -1).map(labelLeaf).join(' / ')}</span>}
            </label>
          )
        })}
      </div>
      <form className="label-new" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="תווית חדשה" aria-label="שם התווית החדשה" dir="auto" />
        <button type="submit" className="pill-btn" disabled={!name.trim()}>
          יצירה וסימון
        </button>
      </form>
      {only?.from.email && (
        <button type="button" className="rule-link" onClick={() => onRules(only.from.email, worn.length === 1 ? worn[0]!.id : undefined)}>
          לתייג כך תמיד מכתבים מ־<bdi dir="ltr">{only.from.email}</bdi>
        </button>
      )}
    </Sheet>
  )
}

type RulesProps = {
  /** Start the form with this sender… */
  from?: string
  /** …and this label. */
  labelId?: string
  onClose: () => void
}

const NEW_LABEL = '+new'

/** Automatic labels: mail from a sender on the list gets its label by itself. */
export function RulesSheet({ from: startFrom = '', labelId: startLabel = '', onClose }: RulesProps) {
  const { rules, labels } = useMailbox()
  const [from, setFrom] = useState(startFrom)
  const [labelId, setLabelId] = useState(startLabel)
  const [newName, setNewName] = useState('')
  const [existing, setExisting] = useState(true)
  const [busy, setBusy] = useState(false)
  const ready = from.trim() !== '' && (labelId === NEW_LABEL ? newName.trim() !== '' : labelId !== '')

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !ready) return
    setBusy(true)
    let target = labelId
    if (target === NEW_LABEL) {
      const created = await mailbox.addLabel(newName)
      if (!created) {
        setBusy(false)
        return
      }
      target = created.id
      setLabelId(created.id)
      setNewName('')
    }
    if (await mailbox.addRule(from, target, existing)) setFrom('')
    setBusy(false)
  }

  return (
    <Sheet title="תיוג אוטומטי" form="טופס 9 · הוראות מיון" onClose={onClose}>
      <p className="setting-note">מכתב חדש משולח שברשימה מקבל את התווית שלו לבד, עד דקה אחרי שהגיע.</p>
      {rules.length > 0 && (
        <ul className="rules">
          {rules.map((rule) => {
            const label = labels.find((other) => other.id === rule.labelId)
            return (
              <li key={rule.id}>
                <span className="rule-from ellipsis" dir="ltr">
                  {rule.match}
                </span>
                {label ? <LabelTape label={label} /> : <span className="rule-gone">תווית שנמחקה</span>}
                <button type="button" className="icon-btn" onClick={() => void mailbox.removeRule(rule.id)} aria-label={`הסרת הכלל של ${rule.match}`} title="הסרת הכלל">
                  <CloseIcon />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <form className="rule-new" onSubmit={add}>
        <label className="setting">
          <span className="setting-title">ממי</span>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="dana@example.com או bank.co.il"
            dir="ltr"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="setting-note">כתובת מלאה, או רק שם האתר שאחרי ה־@, כדי לתפוס את כל מי ששולח ממנו.</span>
        </label>
        <label className="setting">
          <span className="setting-title">איזו תווית</span>
          <select value={labelId} onChange={(e) => setLabelId(e.target.value)}>
            <option value="" disabled>
              בחירת תווית
            </option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
            <option value={NEW_LABEL}>תווית חדשה…</option>
          </select>
        </label>
        {labelId === NEW_LABEL && (
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם התווית החדשה" aria-label="שם התווית החדשה" dir="auto" />
        )}
        <Check checked={existing} onChange={setExisting} title="לתייג גם מכתבים שכבר הגיעו" />
        <button type="submit" className="pill-btn" disabled={!ready || busy}>
          {busy ? 'שומרים…' : 'הוספת הכלל'}
        </button>
      </form>
    </Sheet>
  )
}

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['c'], action: 'מכתב חדש' },
  { keys: ['/'], action: 'חיפוש' },
  { keys: ['j', 'k'], action: 'המכתב הבא / הקודם' },
  { keys: ['u', 'Esc'], action: 'חזרה לרשימה' },
  { keys: ['r'], action: 'השב' },
  { keys: ['a'], action: 'השב לכולם' },
  { keys: ['f'], action: 'העבר' },
  { keys: ['e'], action: 'תיוק' },
  { keys: ['#'], action: 'מחיקה' },
  { keys: ['s'], action: 'כוכב' },
  { keys: ['x'], action: 'בחירת המכתב' },
  { keys: ['Shift', 'u'], action: 'סימון כלא נקרא' },
  { keys: ['g', 'i'], action: 'מעבר לדואר נכנס' },
  { keys: ['g', 's'], action: 'מעבר למסומנים' },
  { keys: ['g', 't'], action: 'מעבר לנשלחו' },
  { keys: ['g', 'd'], action: 'מעבר לטיוטות' },
  { keys: ['Ctrl', 'Enter'], action: 'שליחת המכתב' },
  { keys: ['?'], action: 'הדף הזה' },
]

type ScheduleProps = {
  /** The time the letter is set for now, when changing it. */
  current?: string
  onPick: (when: Date) => void
  onClose: () => void
}

/** Choose when a letter goes out: a ready-made time, or any date and hour. */
export function ScheduleSheet({ current, onPick, onClose }: ScheduleProps) {
  const [now] = useState(() => new Date())
  const presets = schedulePresets(now)
  const [custom, setCustom] = useState(() => toFieldTime(current ? new Date(current) : presets.at(-1)!.when))
  const chosen = new Date(custom)
  const valid = !Number.isNaN(chosen.getTime()) && chosen.getTime() > now.getTime() + 60_000

  return (
    <Sheet title="שליחה מאוחר יותר" form="טופס 12 · מועד המשלוח" onClose={onClose}>
      <ul className="presets">
        {presets.map((preset) => (
          <li key={preset.label}>
            <button type="button" onClick={() => onPick(preset.when)}>
              <span>{preset.label}</span>
              <span className="preset-time">{formatWhen(preset.when, now)}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="schedule-custom"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (valid) onPick(chosen)
        }}
      >
        <label className="setting">
          <span className="setting-title">מועד אחר</span>
          <input type="datetime-local" value={custom} min={toFieldTime(now)} onChange={(e) => setCustom(e.target.value)} />
        </label>
        <button type="submit" className="pill-btn" disabled={!valid}>
          קביעת המועד
        </button>
      </form>
      <p className="setting-note">
        המכתב יוצא מהשרת של דואר במועד שקבעתם, גם אם הטלפון והמחשב כבויים. עד אז הוא מחכה ב„מתוזמנים”, ואפשר לשנות או לבטל.
      </p>
    </Sheet>
  )
}

const GUIDE: { title: string; text: string }[] = [
  {
    title: 'תיוק',
    text: 'החלקה שמאלה על מכתב מוציאה אותו מהדואר הנכנס. הוא לא נמחק: הוא מחכה בתיקייה „מתויקים” ובחיפוש.',
  },
  {
    title: 'נקרא ולא נקרא',
    text: 'החלקה ימינה מסמנת מכתב כנקרא, או מחזירה אותו ללא נקרא.',
  },
  {
    title: 'כמה מכתבים יחד',
    text: 'לחיצה ארוכה על מכתב (או לחיצה על הבול שלו) בוחרת אותו. אחר כך בוחרים עוד, ומתייקים או מוחקים את כולם בבת אחת.',
  },
  {
    title: 'צרורות',
    text: 'עדכונים, פרסומות ורשתות חברתיות נקשרים לצרור אחד, כדי שהמכתבים האישיים יבלטו. אפשר לכבות בהגדרות.',
  },
  {
    title: 'תוויות',
    text: 'תווית היא מדבקה על מכתב, ואפשר לשים כמה. פותחים מכתב, לוחצים על שלוש הנקודות ובוחרים „תוויות”. כל תווית מופיעה בתפריט. העיפרון שליד „תוויות” בתפריט משנה שם וצבע של תווית, או מוחק אותה.',
  },
  {
    title: 'שיחות ארוכות',
    text: 'מכתבים קודמים שמצוטטים בתוך תשובה מקופלים מאחורי שלוש נקודות. לחיצה עליהן פותחת אותם.',
  },
  {
    title: 'העתקת שם וכתובת',
    text: 'במכתב פתוח, לחיצה על שם השולח או על הכתובת שלו מעתיקה אותם.',
  },
  {
    title: 'תיוג אוטומטי',
    text: 'בתפריט, מתחת לתוויות: בוחרים שולח ותווית, ומאז כל מכתב ממנו מקבל אותה לבד. אפשר גם מתוך מכתב: שלוש הנקודות, „תוויות”, ואז „לתייג כך תמיד”.',
  },
  {
    title: 'שליחה מאוחר יותר',
    text: 'בכתיבת מכתב, השעון שליד „שליחה” קובע לו מועד. המכתב יוצא לבד, גם כשהמכשירים כבויים, ועד אז מחכה ב„מתוזמנים”.',
  },
  {
    title: 'התראות',
    text: 'מפעילים בהגדרות, בכל מכשיר בנפרד. בטלפון: מתקינים את דואר דרך Chrome. במחשב: דרך Edge, שמתריע גם כשהוא סגור.',
  },
  {
    title: 'בדיקת דואר',
    text: 'הדואר מתעדכן לבד. בטלפון אפשר גם למשוך את הרשימה למטה.',
  },
]

/** The few things worth knowing, in plain words. */
export function GuideSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="מדריך קצר" form="נספח ב׳ · למשתמש" onClose={onClose}>
      <ol className="guide">
        {GUIDE.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.text}</span>
          </li>
        ))}
      </ol>
    </Sheet>
  )
}

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="קיצורי מקלדת" form="נספח א׳ · למקלדת" onClose={onClose}>
      <dl className="shortcuts">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.action}>
            <dt dir="ltr">
              {shortcut.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dt>
            <dd>{shortcut.action}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  )
}
