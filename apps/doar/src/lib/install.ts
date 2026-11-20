import { useSyncExternalStore } from 'react'
import { isNative } from './platform'

/**
 * Installing Doar as an app (its own icon and window). Browsers that support it
 * announce it with an event; holding on to that event lets Doar offer its own
 * "install" button instead of sending people to hunt through the browser's menu.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const standalone = () =>
  isNative || window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export type InstallState = {
  /** The browser is ready to install Doar right now. */
  available: boolean
  /** Doar is running as an installed app. */
  installed: boolean
}

let pending: InstallEvent | null = null
let state: InstallState = { available: false, installed: standalone() }
const listeners = new Set<() => void>()

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

window.addEventListener('beforeinstallprompt', (event) => {
  // Keep the browser's own banner away; Doar asks at a better moment.
  event.preventDefault()
  pending = event as InstallEvent
  set({ available: true })
})

window.addEventListener('appinstalled', () => {
  pending = null
  set({ available: false, installed: true })
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Show the browser's install dialog. Resolves to true if the person agreed. */
export async function promptInstall(): Promise<boolean> {
  if (!pending) return false
  const event = pending
  pending = null
  set({ available: false })
  await event.prompt()
  return (await event.userChoice).outcome === 'accepted'
}
