import * as postman from './postman'

/**
 * Fault reports: when something fails on this device, Doar's server gets a short
 * note of where in the app it happened and what the error said, so the failure
 * can be explained afterwards. A report never carries mail text: quoted text and
 * addresses inside an error's words are blanked out before it leaves the device.
 */

/** The running app's version: when it was built, and the commit when that is known. */
export const APP_VERSION: string = __APP_VERSION__

/** "מחשב · Edge", "טלפון · Chrome": how this device is named in the server's lists. */
export function deviceName(): string {
  const agent = navigator.userAgent
  const kind = /Android|iPhone|iPad/i.test(agent) ? 'טלפון' : 'מחשב'
  const browser = /Edg/i.test(agent) ? 'Edge' : /SamsungBrowser/i.test(agent) ? 'Samsung' : /Firefox/i.test(agent) ? 'Firefox' : /Chrome/i.test(agent) ? 'Chrome' : 'דפדפן'
  return `${kind} · ${browser}`
}

/** An error's own words, without anything that might be a piece of a letter. */
function words(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : JSON.stringify(error) ?? String(error)
  return raw
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g, '<address>')
    .replace(/"[^"]{12,}"/g, '"…"')
    .replace(/'[^']{12,}'/g, "'…'")
    .slice(0, 400)
}

/** Where in the code it happened: file and line of the first few frames, never values. */
function frames(error: unknown): string[] | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined
  return error.stack
    .split('\n')
    .slice(1, 5)
    .map((line) => line.trim().replace(/https?:\/\/[^/\s]+/g, '').slice(0, 160))
}

const seen = new Set<string>()
let sent = 0

/** Leave a trace of a failure. The same failure is reported once per visit, and a visit sends at most 25. */
export function report(place: string, error: unknown, detail: Record<string, unknown> = {}) {
  const message = words(error)
  const key = `${place}|${message}`
  if (seen.has(key) || sent >= 25) return
  seen.add(key)
  sent++
  postman
    .report({
      place,
      message,
      detail: { ...detail, stack: frames(error), online: navigator.onLine, visible: document.visibilityState, standalone: window.matchMedia('(display-mode: standalone)').matches },
      version: APP_VERSION,
      device: deviceName(),
    })
    .catch(() => {
      // Not signed in, or no connection: the trace is lost, and nothing else is affected.
    })
}

/** Report anything that goes wrong without being caught. Call once at startup. */
export function watchForFaults() {
  window.addEventListener('error', (event) => {
    // Pictures and scripts that fail to load arrive here too, with no error object.
    if (!event.error && !event.message) return
    // The browser's remark that a resize led to another resize is not a failure.
    if (/ResizeObserver loop/i.test(event.message ?? '')) return
    report('window.error', event.error ?? event.message, { at: `${(event.filename ?? '').split('/').pop()}:${event.lineno}` })
  })
  window.addEventListener('unhandledrejection', (event) => report('window.unhandledrejection', event.reason))
}

/** A report the person asked to send from Settings: what this device looks like right now. */
export async function reportNow(): Promise<boolean> {
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  try {
    await postman.report({
      place: 'settings.manual',
      message: 'sent by hand',
      detail: {
        agent: navigator.userAgent.slice(0, 200),
        online: navigator.onLine,
        standalone: window.matchMedia('(display-mode: standalone)').matches,
        notifications: 'Notification' in window ? Notification.permission : 'none',
        worker: registration?.active?.state ?? 'none',
        screen: `${window.innerWidth}x${window.innerHeight}`,
        earlier: [...seen].slice(-10),
      },
      version: APP_VERSION,
      device: deviceName(),
    })
    return true
  } catch {
    return false
  }
}
