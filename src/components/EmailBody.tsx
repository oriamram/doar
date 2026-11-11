import { useRef } from 'react'

/**
 * Renders an email's HTML in a sandboxed iframe: no scripts run, the email's CSS
 * can't leak into the app, and links open outside the app.
 * Later: block remote images (tracking pixels) until the user allows them.
 */
export function EmailBody({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  html { overflow: hidden; }
  body { margin: 0; padding: 20px; font: 15px/1.55 system-ui, sans-serif; color: #1d2321; word-wrap: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #1f5f5b; }
</style></head><body>${html}</body></html>`

  // Grow the iframe to fit its content so the whole thread scrolls as one page,
  // and keep fitting as images load or the window is resized.
  const fitHeight = () => {
    const frame = frameRef.current
    const body = frame?.contentDocument?.body
    if (!frame || !body) return
    const fit = () => (frame.style.height = `${body.scrollHeight}px`)
    fit()
    new ResizeObserver(fit).observe(body)
  }

  return (
    <iframe
      ref={frameRef}
      className="email-body"
      title="Email content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      onLoad={fitHeight}
    />
  )
}
