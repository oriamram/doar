import { mailbox } from './mailbox'

/**
 * Keeps the installed app up to date.
 *
 * The service worker makes the PC/browser version installable and lets it open
 * with no connection. When a new version is deployed, its worker takes over as
 * soon as it has downloaded, and the page reloads to run the new code. It never
 * reloads under a letter you're writing: it waits for the form to close.
 */

const CHECK_EVERY_MS = 30 * 60_000

export function keepAppUpdated() {
  if (!('serviceWorker' in navigator)) return
  // The very first install also "takes control"; only a change of version needs a reload.
  const hadVersion = !!navigator.serviceWorker.controller
  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadVersion || reloading) return
    reloading = true
    const reloadWhenFree = () => {
      if (mailbox.state().compose) setTimeout(reloadWhenFree, 2000)
      else window.location.reload()
    }
    reloadWhenFree()
  })

  navigator.serviceWorker.register('/sw.js').then(
    (registration) => {
      // The browser looks for a new version whenever the app is opened; an app left
      // open for days also looks when you come back to it.
      let lastCheck = Date.now()
      document.addEventListener('visibilitychange', () => {
        if (document.hidden || Date.now() - lastCheck < CHECK_EVERY_MS) return
        lastCheck = Date.now()
        registration.update().catch(() => {})
      })
    },
    () => {
      // No service worker (private window, old browser): the app still works online.
    },
  )
}
