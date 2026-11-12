import { useSyncExternalStore } from 'react'

/** Your preferences, kept on this device. */
export type Settings = {
  theme: 'auto' | 'light' | 'dark'
  /** Added under every new email you write. */
  signature: string
  /** How long "Undo" stays available after pressing Send (0 sends at once). */
  undoSendSeconds: number
  /** Tie promotions, updates and social mail into bundles in the inbox. */
  bundles: boolean
  sounds: boolean
  /** Load pictures that emails link to (off hides them until you ask). */
  remoteImages: boolean
  /** One-time suggestions (install the app, switch on notifications) that were put away. */
  tipsDone: string[]
}

const DEFAULTS: Settings = {
  theme: 'auto',
  signature: '',
  undoSendSeconds: 5,
  bundles: true,
  sounds: false,
  remoteImages: true,
  tipsDone: [],
}

const KEY = 'doar:settings'

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<() => void>()
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** Light or dark, after resolving "auto" against the device's setting. */
export function resolvedTheme(): 'light' | 'dark' {
  if (current.theme !== 'auto') return current.theme
  return darkQuery.matches ? 'dark' : 'light'
}

function applyTheme() {
  const theme = resolvedTheme()
  document.documentElement.dataset.theme = theme
  // The browser's own bars take the desk's color.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#131922' : '#d7cdbc')
}

darkQuery.addEventListener('change', applyTheme)
applyTheme()

export const getSettings = () => current

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Storage is full or blocked; the setting still applies until the app closes.
  }
  applyTheme()
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings)
}
