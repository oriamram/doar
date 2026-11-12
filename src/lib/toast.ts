import { useSyncExternalStore } from 'react'

/** A short note at the bottom of the screen, often with a way to take the action back. */
export type Toast = {
  id: number
  text: string
  action?: { label: string; run: () => void }
  /** How long it stays, in milliseconds. */
  duration: number
  /** Show the time running out (used while "Undo send" is available). */
  countdown?: boolean
  tone?: 'error'
  /** Called when the note leaves without its action being used. */
  onExpire?: () => void
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function toast(text: string, options: Partial<Omit<Toast, 'id' | 'text'>> = {}): number {
  const id = nextId++
  const item: Toast = { id, text, duration: options.action ? 6000 : 3200, ...options }
  // One note at a time keeps the screen calm; a waiting one finishes its job first.
  for (const old of toasts) expire(old.id)
  toasts = [item]
  timers.set(id, setTimeout(() => expire(id), item.duration))
  emit()
  return id
}

/** Remove a note because its time ran out (or a newer note replaced it). */
function expire(id: number) {
  const item = toasts.find((t) => t.id === id)
  if (!item) return
  remove(id)
  item.onExpire?.()
}

function remove(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** The user pressed the note's button. */
export function runToastAction(id: number) {
  const item = toasts.find((t) => t.id === id)
  if (!item) return
  remove(id)
  item.action?.run()
}

export function dismissToast(id: number) {
  expire(id)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts)
}
