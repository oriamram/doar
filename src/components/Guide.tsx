import { useEffect, useRef, useState } from 'react'
import { GUIDE, GUIDE_LEAD, GUIDE_TITLE, TRY_LABELS, type Try } from '../lib/guide'
import { useBackLayer } from '../lib/layers'
import { GuideArt } from './GuideArt'
import { ChevronIcon, CloseIcon } from './icons'

type Props = {
  onClose: () => void
  /**
   * Go to a place in the app. Left out at the front door, where there is no mailbox
   * behind the guide; then the guide ends with the way into the demo mailbox.
   */
  onTry?: (place: Try) => void
  /** The places that can be gone to right now (opening the mail needs mail to open). */
  places?: ReadonlySet<Try>
  /** A form opened from the guide lies over it: the keys are that form's. */
  busy?: boolean
}

/**
 * The guide: everything Doar can do. One row for each thing, with a small picture of
 * the real object, its name, and what the name means; a row opens to say how and why.
 * The tags under the title are the chapters: they jump, and they follow the reading.
 */
export function Guide({ onClose, onTry, places, busy }: Props) {
  const [chapter, setChapter] = useState(GUIDE[0]!.id)
  const [opened, setOpened] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const tabs = useRef<HTMLDivElement>(null)
  useBackLayer(true, onClose)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // The chapter being read is the last one whose heading has passed the top.
  const follow = () => {
    const page = body.current
    if (!page) return
    let reading = GUIDE[0]!.id
    for (const item of GUIDE) {
      const section = document.getElementById(`guide-${item.id}`)
      if (section && section.offsetTop <= page.scrollTop + 28) reading = item.id
    }
    // The last chapter may be too short to ever reach the top.
    if (page.scrollTop + page.clientHeight >= page.scrollHeight - 4) reading = GUIDE.at(-1)!.id
    setChapter(reading)
  }

  // Its tag stays in sight in the rail.
  useEffect(() => {
    const rail = tabs.current
    const tag = rail?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!rail || !tag) return
    rail.scrollTo({ left: tag.offsetLeft - (rail.clientWidth - tag.offsetWidth) / 2, behavior: 'smooth' })
  }, [chapter])

  // What a row says when it opens is brought into view.
  useEffect(() => {
    if (opened) document.getElementById(`guide-more-${opened}`)?.scrollIntoView({ block: 'nearest' })
  }, [opened])

  const goTo = (id: string) => {
    const section = document.getElementById(`guide-${id}`)
    if (section) body.current?.scrollTo({ top: section.offsetTop })
  }

  return (
    <div className="guide-layer" role="dialog" aria-modal="true" aria-label={GUIDE_TITLE}>
      <button className="sheet-backdrop" aria-label="סגירה" onClick={onClose} />
      <div className="guide-book">
        <header className="guide-head">
          <div>
            <span className="form-no">נספח ב׳ · למשתמש</span>
            <h2>{GUIDE_TITLE}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה">
            <CloseIcon />
          </button>
        </header>

        <nav className="guide-rail" aria-label="פרקים">
          <div className="guide-tabs" ref={tabs}>
            {GUIDE.map((item) => (
              <button key={item.id} type="button" className="filter" aria-current={chapter === item.id ? 'true' : undefined} onClick={() => goTo(item.id)}>
                {item.tab}
              </button>
            ))}
          </div>
        </nav>

        <div className="guide-body" ref={body} onScroll={follow}>
          <p className="guide-lead">{GUIDE_LEAD}</p>
          {GUIDE.map((item) => (
            <section key={item.id} id={`guide-${item.id}`} className="guide-chapter" aria-labelledby={`guide-title-${item.id}`}>
              <h3 id={`guide-title-${item.id}`}>{item.title}</h3>
              <ul className="guide-rows">
                {item.entries.map((entry) => {
                  const open = opened === entry.id
                  const place = entry.try
                  return (
                    <li key={entry.id}>
                      <button type="button" className="guide-row" aria-expanded={open} aria-controls={`guide-more-${entry.id}`} onClick={() => setOpened(open ? null : entry.id)}>
                        <GuideArt id={entry.id} />
                        <span className="guide-text">
                          <strong className="guide-name">{entry.name}</strong>
                          <span className="guide-plain">{entry.plain}</span>
                        </span>
                        <span className="guide-chevron">
                          <ChevronIcon />
                        </span>
                      </button>
                      {open && (
                        <div className="guide-more" id={`guide-more-${entry.id}`}>
                          <dl>
                            <div>
                              <dt>איך</dt>
                              <dd>{entry.how}</dd>
                            </div>
                            <div>
                              <dt>למה</dt>
                              <dd>{entry.why}</dd>
                            </div>
                          </dl>
                          {place && onTry && places?.has(place) && (
                            <button type="button" className="pill-btn guide-try" onClick={() => onTry(place)}>
                              {TRY_LABELS[place]}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
              {item.small.length > 0 && (
                <dl className="guide-small">
                  {item.small.map((small) => (
                    <div key={small.name}>
                      <dt>{small.name}:</dt> <dd>{small.plain}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}

          <footer className="guide-end">
            {onTry ? (
              <>
                <p>זה הכול. את השאר לומדים תוך כדי שימוש.</p>
                <button type="button" className="pill-btn" onClick={onClose}>
                  חזרה לדואר
                </button>
              </>
            ) : (
              <>
                <p>רוצים לנסות לפני שמתחברים? בתיבת ההדגמה הדואר מומצא, ואפשר לגעת בכול.</p>
                <a className="pill-btn" href="/?demo">
                  לתיבת ההדגמה
                </a>
              </>
            )}
          </footer>
        </div>
      </div>
    </div>
  )
}
