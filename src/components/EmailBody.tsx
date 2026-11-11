import { useRef } from 'react'

/**
 * Renders an email's HTML in a sandboxed iframe: no scripts run, the email's CSS
 * can't leak into the app, and links open outside the app.
 * Later: block remote images (tracking pixels) until the user allows them.
 */
export function EmailBody({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  // The page stays transparent so the letter's paper shows through plain emails.
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  html { overflow: hidden; background: transparent; }
  body { margin: 0; padding: 16px; font: 16px/1.6 system-ui, sans-serif; color: #1f2a3a; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #a63a26; }
</style></head><body dir="auto">${html}</body></html>`

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
  }

  return (
    <iframe
      ref={frameRef}
      className="email-body"
      title="תוכן המייל"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      onLoad={fit}
    />
  )
}
