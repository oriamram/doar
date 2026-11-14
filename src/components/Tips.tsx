import { isDemo } from '../lib/demo'
import { promptInstall, useInstall } from '../lib/install'
import { enablePush, usePush } from '../lib/push'
import { updateSettings, useSettings } from '../lib/settings'
import { toast } from '../lib/toast'
import { BellIcon, HelpIcon, InstallIcon, MailIcon } from './icons'

/** Edge on Android agrees to notifications but never delivers them (a long-standing fault in that browser). */
const EDGE_ON_ANDROID = /Android/i.test(navigator.userAgent) && /EdgA\//i.test(navigator.userAgent)

/**
 * One-time suggestions at the top of the inbox: read the guide, install Doar as an app,
 * switch on notifications. One at a time, and each can be put away for good.
 */
export function Tips() {
  const install = useInstall()
  const push = usePush()
  const { tipsDone } = useSettings()
  const done = (tip: string) => updateSettings({ tipsDone: [...tipsDone, tip] })
  const open = (tip: string) => !tipsDone.includes(tip)

  if (isDemo && open('demo')) {
    return (
      <div className="tip">
        <MailIcon />
        <p>
          <strong>זאת תיבת הדגמה.</strong> הדואר כאן מומצא, ושום מכתב לא נשלח באמת. אפשר לנסות הכל.
        </p>
        <div className="tip-actions">
          <a className="tip-yes" href="/">
            לדואר שלי
          </a>
          <button type="button" onClick={() => done('demo')}>
            הבנתי
          </button>
        </div>
      </div>
    )
  }

  // First of all, what Doar is for: a newcomer reads that before deciding to install it.
  if (open('guide')) {
    return (
      <div className="tip">
        <HelpIcon />
        <p>
          <strong>מה דואר יודע לעשות?</strong> הכול בדף אחד: שורה ותמונה לכל דבר.
        </p>
        <div className="tip-actions">
          <button
            type="button"
            className="tip-yes"
            onClick={() => {
              done('guide')
              window.dispatchEvent(new Event('doar:guide'))
            }}
          >
            לקרוא
          </button>
          <button type="button" onClick={() => done('guide')}>
            לא עכשיו
          </button>
        </div>
      </div>
    )
  }

  if (EDGE_ON_ANDROID && !install.installed && open('edge')) {
    return (
      <div className="tip">
        <BellIcon />
        <p>
          <strong>רוצים התראות בטלפון?</strong> Edge בטלפון לא מקבל התראות מאתרים. פתחו את דואר ב־Chrome, התקינו אותו משם, והפעילו שם
          את ההתראות.
        </p>
        <div className="tip-actions">
          <button type="button" onClick={() => done('edge')}>
            הבנתי
          </button>
        </div>
      </div>
    )
  }

  if (install.available && open('install')) {
    return (
      <div className="tip">
        <InstallIcon />
        <p>
          <strong>להתקין את דואר כאפליקציה?</strong> אייקון משלו, מסך מלא, ונפתח מהר.
        </p>
        <div className="tip-actions">
          <button
            type="button"
            className="tip-yes"
            onClick={() =>
              void promptInstall().then((installed) => {
                if (!installed) done('install')
              })
            }
          >
            התקנה
          </button>
          <button type="button" onClick={() => done('install')}>
            לא עכשיו
          </button>
        </div>
      </div>
    )
  }

  if (push.supported && !push.on && !push.broken && push.permission === 'default' && !EDGE_ON_ANDROID && open('push')) {
    return (
      <div className="tip">
        <BellIcon />
        <p>
          <strong>לקבל התראה כשמגיע מכתב?</strong> גם כשדואר סגור. אפשר לכבות בהגדרות.
        </p>
        <div className="tip-actions">
          <button
            type="button"
            className="tip-yes"
            disabled={push.busy}
            onClick={() =>
              void enablePush().then((result) => {
                done('push')
                if (result === 'on') toast('ההתראות הופעלו במכשיר הזה.')
                else if (result === 'blocked') toast('ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות האתר.', { tone: 'error' })
                else if (result === 'broken') toast('הדפדפן הזה לא מקבל התראות. נסו ב־Chrome.', { tone: 'error' })
                else toast('לא הצלחנו להפעיל התראות כאן. אפשר לנסות שוב בהגדרות.', { tone: 'error' })
              })
            }
          >
            הפעלה
          </button>
          <button type="button" onClick={() => done('push')}>
            לא עכשיו
          </button>
        </div>
      </div>
    )
  }

  return null
}
