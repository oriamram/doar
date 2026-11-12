import { useSyncExternalStore } from 'react'
import { isNative } from './platform'
import * as postman from './postman'

/**
 * Notifications about new mail while Doar is closed.
 *
 * The browser gives this device an address ("subscription"); Doar's server keeps it
 * and sends a notification there when mail arrives. Each device is switched on by itself.
 */

export type PushState = {
  /** Can this browser receive notifications at all? */
  supported: boolean
  /** The browser's answer: not asked yet, allowed, or blocked. */
  permission: NotificationPermission
  /** This device is receiving notifications. */
  on: boolean
  /** The browser agreed but handed out an address that can't receive anything (Edge on Android). */
  broken: boolean
  busy: boolean
  scope: postman.NotifyScope
  /** How many of your devices receive notifications. */
  devices: number
}

const supported = !isNative && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

let state: PushState = {
  supported,
  permission: supported ? Notification.permission : 'denied',
  on: false,
  broken: false,
  busy: false,
  scope: 'important',
  devices: 0,
}
const listeners = new Set<() => void>()

function set(patch: Partial<PushState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePush(): PushState {
  return useSyncExternalStore(subscribe, () => state)
}

export const pushState = () => state

/** "מחשב · Edge", "טלפון · Chrome": how this device is named in the server's list. */
function deviceName(): string {
  const agent = navigator.userAgent
  const kind = /Android|iPhone|iPad/i.test(agent) ? 'טלפון' : 'מחשב'
  const browser = /Edg/i.test(agent) ? 'Edge' : /SamsungBrowser/i.test(agent) ? 'Samsung' : /Firefox/i.test(agent) ? 'Firefox' : /Chrome/i.test(agent) ? 'Chrome' : 'דפדפן'
  return `${kind} · ${browser}`
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((byte, index) => byte === b[index])

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported) return null
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

const isPlaceholder = (subscription: PushSubscription) => new URL(subscription.endpoint).hostname.endsWith('.invalid')

async function register(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('incomplete subscription')
  await postman.pushSubscribe({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, deviceName())
}

/**
 * Called when the mailbox starts, with what the server knows. A device that was
 * switched on stays on: if the server lost its address, it is sent again.
 */
export async function syncPush(server: Pick<postman.ServerStatus, 'scope' | 'endpoints'>) {
  set({ scope: server.scope, devices: server.endpoints.length })
  if (!supported) return
  try {
    const subscription = await currentSubscription()
    const allowed = Notification.permission === 'granted'
    if (!subscription || !allowed) {
      set({ permission: Notification.permission, on: false })
      return
    }
    if (isPlaceholder(subscription)) {
      set({ permission: Notification.permission, on: false, broken: true })
      return
    }
    if (!server.endpoints.includes(subscription.endpoint)) {
      await register(subscription)
      set({ devices: server.endpoints.length + 1 })
    }
    set({ permission: Notification.permission, on: true })
  } catch {
    // Not now; the next start tries again.
  }
}

export type EnableResult = 'on' | 'blocked' | 'broken' | 'unsupported' | 'failed'

/** Switch notifications on for this device. Must be called from a tap or a click. */
export async function enablePush(): Promise<EnableResult> {
  if (!supported) return 'unsupported'
  set({ busy: true })
  try {
    const permission = await Notification.requestPermission()
    set({ permission })
    if (permission !== 'granted') return 'blocked'

    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return 'unsupported'
    const key = keyBytes(await postman.pushKey())
    let subscription = await registration.pushManager.getSubscription()
    // An address made for another server key can't be used; make a new one.
    if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
      await subscription.unsubscribe()
      subscription = null
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    if (isPlaceholder(subscription)) {
      await subscription.unsubscribe().catch(() => {})
      set({ broken: true, on: false })
      return 'broken'
    }
    await register(subscription)
    set({ on: true, broken: false, devices: Math.max(1, state.devices + (state.on ? 0 : 1)) })
    return 'on'
  } catch {
    return 'failed'
  } finally {
    set({ busy: false })
  }
}

export async function disablePush() {
  set({ busy: true })
  try {
    const subscription = await currentSubscription()
    if (subscription) {
      await postman.pushUnsubscribe(subscription.endpoint).catch(() => {})
      await subscription.unsubscribe().catch(() => {})
    }
    set({ on: false, devices: Math.max(0, state.devices - 1) })
  } finally {
    set({ busy: false })
  }
}

export async function setPushScope(scope: postman.NotifyScope) {
  const before = state.scope
  set({ scope })
  try {
    await postman.pushScope(scope)
  } catch {
    set({ scope: before })
    throw new Error('scope not saved')
  }
}

/** Ask the server to send a test notification to all of your devices; resolves to how many accepted it. */
export async function testPush(): Promise<{ sent: number; total: number }> {
  const results = await postman.pushTest()
  return { sent: results.filter((result) => result.status >= 200 && result.status < 300).length, total: results.length }
}

/** Signing out: stop notifications for this device. */
export async function forgetPush() {
  if (!supported) return
  const subscription = await currentSubscription().catch(() => null)
  if (!subscription) return
  await postman.pushUnsubscribe(subscription.endpoint).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
  set({ on: false })
}
