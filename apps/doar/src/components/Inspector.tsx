import type { Finding, LinkRisk } from '../lib/inspector'
import { toast } from '../lib/toast'
import { HandIcon, ShieldIcon } from './icons'

/**
 * The wax seal beside a sender's address: intact when Gmail verified where the letter
 * came from and nothing about it looks off, broken when something serious does.
 */
export function Seal({ finding }: { finding: Finding }) {
  if (!finding.seal) return null
  const intact = finding.seal === 'intact'
  const text = intact ? `השולח אומת: Gmail בדק שהמכתב באמת נשלח מ־${finding.verified}.` : 'השולח לא אומת. הפרטים כתובים בראש המכתב.'
  return (
    <button type="button" className="seal-line" data-state={finding.seal} onClick={() => toast(text)} title={text}>
      <span className="seal" aria-hidden="true" />
      {intact ? 'השולח אומת' : 'השולח לא אומת'}
    </button>
  )
}

type StripProps = {
  finding: Finding
  onTrust: () => void
  onSpam: () => void
  onReturn: () => void
}

/** What the inspector found, at the head of the letter: serious signs in red, softer ones in amber. */
export function InspectStrip({ finding, onTrust, onSpam, onReturn }: StripProps) {
  const serious = finding.warnings.length > 0
  // With a serious sign, the softer ones are part of the same picture.
  const lines = serious ? [...finding.warnings, ...finding.cautions] : finding.cautions
  if (lines.length === 0) return null
  return (
    <div className="inspect-strip" data-level={serious ? 'warning' : 'caution'} role={serious ? 'alert' : 'note'}>
      <ShieldIcon />
      <div className="inspect-text">
        <strong>{serious ? 'כדאי לחשוד במכתב הזה' : 'שימו לב לשולח'}</strong>
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
        <span className="inspect-advice">{serious ? 'אל תמסרו פרטים ואל תיכנסו לחשבון דרך קישור במכתב.' : 'ייתכן שהכול בסדר. אם לא ציפיתם למכתב, אל תמסרו פרטים דרך קישור שבו.'}</span>
      </div>
      <div className="inspect-actions">
        {serious ? (
          <>
            <button type="button" onClick={onSpam}>
              דיווח כספאם
            </button>
            <button type="button" onClick={onReturn}>
              החזר לשולח
            </button>
          </>
        ) : (
          <button type="button" onClick={onTrust}>
            השולח מוכר לי
          </button>
        )}
      </div>
    </div>
  )
}

/** The post office's red stamp on a letter that was sent back. It stays in sight wherever the letter is scrolled to. */
export function ReturnedStamp() {
  return (
    <div className="returned-holder">
      <span className="returned-stamp" role="img" aria-label="הוחזר לשולח">
        <HandIcon />
        <span>
          הוחזר
          <br />
          לשולח
        </span>
      </span>
    </div>
  )
}

const RISK_TEXT: Record<LinkRisk['why'], (risk: LinkRisk) => string> = {
  'other-site': (risk) => `על הקישור כתוב ${risk.shown}, אבל הוא מוביל אל ${risk.target}.`,
  number: (risk) => `הקישור מוביל אל כתובת מספרית (${risk.target}), בלי שם של אתר.`,
  short: (risk) => `הקישור מקוצר (${risk.target}), כך שאי אפשר לדעת לאן הוא מוביל.`,
}

type LinkSlipProps = { risk: LinkRisk; onOpen: () => void; onClose: () => void }

/** Before a doubtful link opens: where it really leads, and the choice. */
export function LinkSlip({ risk, onOpen, onClose }: LinkSlipProps) {
  return (
    <div className="link-slip" role="alertdialog" aria-label="לאן הקישור מוביל">
      <ShieldIcon />
      <span className="link-slip-text">{RISK_TEXT[risk.why](risk)}</span>
      <span className="link-slip-actions">
        <button type="button" className="link-slip-stay" onClick={onClose}>
          לא לפתוח
        </button>
        <button type="button" onClick={onOpen}>
          לפתוח בכל זאת
        </button>
      </span>
    </div>
  )
}
