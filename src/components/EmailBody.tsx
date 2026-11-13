import { useEffect, useMemo, useRef, useState } from 'react'
import { getAttachmentBytes } from '../lib/gmail'
import { countMarks, linkRisk, stripTrackers, type LinkRisk } from '../lib/inspector'
import { foldQuotes } from '../lib/quotes'
import { useSettings } from '../lib/settings'
import type { Message } from '../types'
import { ShieldIcon } from './icons'
import { LinkSlip } from './Inspector'

/** Does the email link to pictures on the internet (which can tell the sender you opened it)? */
const hasRemoteImages = (html: string) => /<img[^>]+src\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html)

type Props = {
  message: Message
  /** The inspector found something about this letter: its links are checked more strictly. */
  flagged?: boolean
}

/**
 * Renders an email's HTML in a sandboxed iframe: no scripts run, the email's CSS
 * can't leak into the app, and links open outside the app.
 */
export function EmailBody({ message, flagged = false }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const { remoteImages } = useSettings()
  const [allowImages, setAllowImages] = useState(false)
  const body = useMemo(() => stripTrackers(message.bodyHtml), [message.bodyHtml])
  const blocked = !remoteImages && !allowImages && hasRemoteImages(body.html)
  // A link the reader pressed that leads somewhere other than it says: asked about before it opens.
  const [doubt, setDoubt] = useState<{ risk: LinkRisk; href: string } | null>(null)
  const strict = useRef({ flagged, list: message.bulk })
  useEffect(() => {
    strict.current = { flagged, list: message.bulk }
  }, [flagged, message.bulk])

  // The page stays transparent so the letter's paper shows through plain emails.
  // When pictures are held back, a content policy keeps the browser from fetching them.
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${blocked ? `<meta http-equiv="Content-Security-Policy" content="img-src data: blob:; media-src 'none'">` : ''}
<base target="_blank">
<style>
  html { overflow: hidden; background: transparent; }
  body { margin: 0; padding: 16px; font: 16px/1.6 system-ui, sans-serif; color: #1f2a3a; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #8f2f1f; }
  blockquote { margin: 0 0 0 .8ex; padding-left: 1ex; border-left: 2px solid #cfc4ad; color: #574f42; }
  .doar-quote-tab { display: block; margin: 12px 0 4px; padding: 0 14px; height: 26px; border: 1px solid #cfc4ad; border-radius: 13px; background: #f0e7d3; color: #574f42; font: 900 16px/20px system-ui, sans-serif; letter-spacing: 3px; cursor: pointer; }
  .doar-quote-tab:focus-visible { outline: 2px solid #24407a; outline-offset: 2px; }
</style></head><body dir="auto">${body.html}</body></html>`

  // Blob addresses made for pictures inside the email; released when the email leaves the screen.
  const urls = useRef<string[]>([])
  useEffect(
    () => () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url))
      urls.current = []
    },
    [message.id],
  )

  /**
   * Make the iframe as tall as its content so the thread scrolls as one page.
   * Newsletters built wider than the screen (often 600px) are scaled down to fit,
   * as Gmail does, instead of being cut off. Re-fits as images load or the window resizes.
   */
  const fit = () => {
    const frame = frameRef.current
    const page = frame?.contentDocument?.documentElement
    const content = frame?.contentDocument?.body
    if (!frame || !page || !content) return
    const fitHeight = () => {
      frame.style.height = `${page.scrollHeight}px`
    }
    // Earlier letters quoted under this one are folded behind a small tab. Folding makes the
    // letter shorter, and a frame is never shorter than its page says, so it is emptied first.
    foldQuotes(content, () => {
      frame.style.height = '0'
      fitHeight()
    })
    // The email's own width, measured once before any scaling.
    const natural = Math.max(content.scrollWidth, page.scrollWidth)
    const fitWidth = () => {
      const scale = Math.min(1, frame.clientWidth / natural)
      content.style.zoom = scale < 1 ? String(scale) : ''
      fitHeight()
    }
    fitWidth()
    new ResizeObserver(fitHeight).observe(content)
    frame.contentWindow?.addEventListener('resize', fitWidth)

    // A link that leads somewhere other than it says is asked about first.
    content.addEventListener('click', (event) => {
      // The frame has its own "Element", so the target is told apart by what it is, not by its class.
      const target = event.target as Node | null
      const link = (target?.nodeType === 1 ? (target as Element) : target?.parentElement)?.closest('a[href]')
      const href = link?.getAttribute('href')
      if (!link || !href) return
      const risk = linkRisk(link.textContent ?? '', href, strict.current)
      if (!risk) return
      event.preventDefault()
      setDoubt({ risk, href })
    })

    // Pictures that travel inside the email ("cid:" references) are fetched and put in place.
    for (const image of content.querySelectorAll<HTMLImageElement>('img[src^="cid:"]')) {
      const contentId = image.getAttribute('src')!.slice(4)
      const file = message.attachments.find((attachment) => attachment.contentId === contentId)
      if (!file) continue
      getAttachmentBytes(file).then(
        (bytes) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
          urls.current.push(url)
          image.src = url
        },
        () => {},
      )
    }
  }

  return (
    <>
      {blocked && (
        <p className="images-note">
          התמונות במכתב הזה מוסתרות.
          <button onClick={() => setAllowImages(true)}>להציג תמונות</button>
        </p>
      )}
      {doubt && (
        <LinkSlip
          risk={doubt.risk}
          onClose={() => setDoubt(null)}
          onOpen={() => {
            window.open(doubt.href, '_blank', 'noopener')
            setDoubt(null)
          }}
        />
      )}
      <iframe
        ref={frameRef}
        className="email-body"
        title="תוכן המכתב"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        onLoad={fit}
      />
      {body.removed > 0 && (
        <p className="marks-note">
          <ShieldIcon />
          {countMarks(body.removed)}
        </p>
      )}
    </>
  )
}
