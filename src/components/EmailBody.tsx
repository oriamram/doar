import { useEffect, useRef, useState } from 'react'
import { getAttachmentBytes } from '../lib/gmail'
import { useSettings } from '../lib/settings'
import type { Message } from '../types'

/** Does the email link to pictures on the internet (which can tell the sender you opened it)? */
const hasRemoteImages = (html: string) => /<img[^>]+src\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html)

/**
 * Renders an email's HTML in a sandboxed iframe: no scripts run, the email's CSS
 * can't leak into the app, and links open outside the app.
 */
export function EmailBody({ message }: { message: Message }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const { remoteImages } = useSettings()
  const [allowImages, setAllowImages] = useState(false)
  const blocked = !remoteImages && !allowImages && hasRemoteImages(message.bodyHtml)

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
</style></head><body dir="auto">${message.bodyHtml}</body></html>`

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
    const body = frame?.contentDocument?.body
    if (!frame || !page || !body) return
    // The email's own width, measured once before any scaling.
    const natural = Math.max(body.scrollWidth, page.scrollWidth)
    const fitHeight = () => {
      frame.style.height = `${page.scrollHeight}px`
    }
    const fitWidth = () => {
      const scale = Math.min(1, frame.clientWidth / natural)
      body.style.zoom = scale < 1 ? String(scale) : ''
      fitHeight()
    }
    fitWidth()
    new ResizeObserver(fitHeight).observe(body)
    frame.contentWindow?.addEventListener('resize', fitWidth)

    // Pictures that travel inside the email ("cid:" references) are fetched and put in place.
    for (const image of body.querySelectorAll<HTMLImageElement>('img[src^="cid:"]')) {
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
      <iframe
        ref={frameRef}
        className="email-body"
        title="תוכן המכתב"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        onLoad={fit}
      />
    </>
  )
}
