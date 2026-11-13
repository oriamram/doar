import { useSyncExternalStore } from 'react'
import { storageKey } from './demo'
import * as postman from './postman'

/** Your preferences. */
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
  /** Corrections: kinds of mail a sender's letters are not ("this is not a parcel"), by address. */
  notKinds: Record<string, string[]>
  /** Senders you said you know, so the inspector's soft notes about them are put away. */
  trusted: string[]
}

const DEFAULTS: Settings = {
  theme: 'auto',
  signature: '',
  undoSendSeconds: 5,
  bundles: true,
  sounds: false,
  remoteImages: true,
  tipsDone: [],
  notKinds: {},
  trusted: [],
}

/**
 * These follow you to every device: Doar's server keeps them, and each device takes
 * them when it starts. The rest (day or night, sounds, which tips were put away)
 * belong to the device they were chosen on.
 */
const SHARED = ['signature', 'undoSendSeconds', 'bundles', 'remoteImages', 'notKinds', 'trusted'] as const
type SharedKey = (typeof SHARED)[number]

const KEY = storageKey('doar:settings')

type Stored = Partial<Settings> & { pending?: SharedKey[] }

function load(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored
  } catch {
    return {}
  }
}

const { pending: unsent = [], ...saved } = load()
let current: Settings = { ...DEFAULTS, ...saved }
/** Shared settings changed here that the server hasn't been told about yet. */
const pending = new Set<SharedKey>(unsent.filter((key) => SHARED.includes(key)))

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

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current, pending: [...pending] }))
  } catch {
    // Storage is full or blocked; the setting still applies until the app closes.
  }
}

let pushTimer: ReturnType<typeof setTimeout> | undefined

/** Tell the server what changed, a moment after the last change. */
function pushSoon() {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    if (pending.size === 0) return
    const keys = [...pending]
    const sent: Record<string, unknown> = Object.fromEntries(keys.map((key) => [key, current[key]]))
    postman.prefsSet(sent).then(
      () => {
        // A setting changed again while this was on its way stays pending.
        for (const key of keys) if (JSON.stringify(current[key]) === JSON.stringify(sent[key])) pending.delete(key)
        save()
      },
      () => {
        // No connection, or not signed in: it stays pending, and the next start sends it.
      },
    )
  }, 900)
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  for (const key of SHARED) if (key in patch) pending.add(key)
  save()
  applyTheme()
  listeners.forEach((listener) => listener())
  if (pending.size) pushSoon()
}

/**
 * Take the settings the server keeps for all your devices (null: it keeps none yet,
 * so this device's settings become the shared ones). A setting changed here and not
 * yet sent wins over the server's. Returns the settings that changed on this device.
 */
export function applyShared(remote: Record<string, unknown> | null): (keyof Settings)[] {
  const changed: SharedKey[] = []
  const next: Record<string, unknown> = { ...current }
  for (const key of SHARED) {
    if (pending.has(key)) continue
    const value = remote?.[key]
    // The server doesn't have this one (a first device, or a setting newer than its record): send ours.
    if (value === undefined) pending.add(key)
    else if (typeof value === typeof DEFAULTS[key] && Array.isArray(value) === Array.isArray(DEFAULTS[key]) && JSON.stringify(value) !== JSON.stringify(current[key])) {
      next[key] = value
      changed.push(key)
    }
  }
  if (changed.length) {
    current = next as Settings
    save()
    listeners.forEach((listener) => listener())
  }
  if (pending.size) pushSoon()
  return changed
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings)
}
