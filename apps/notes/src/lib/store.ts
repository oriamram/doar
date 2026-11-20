// The one copy of the notes that the app works on, kept on this device (the browser's
// own storage). There is no account and no server yet: what is written here stays here.

import { useSyncExternalStore } from 'react'
import { discard, read, restore, save, tidy, write, type Note } from './notes.ts'

const KEY = 'pitkiyot:notes'

type State = {
  notes: Note[]
  /** The last change could not be saved (storage full, or blocked by the browser). */
  unsaved: boolean
}

function load(): Note[] {
  try {
    return tidy(read(localStorage.getItem(KEY)))
  } catch {
    // Storage is blocked (a private window with strict settings): notes live until the page closes.
    return []
  }
}

let state: State = { notes: load(), unsaved: false }
const listeners = new Set<() => void>()

function set(notes: Note[]) {
  if (notes === state.notes) return
  let unsaved = false
  try {
    localStorage.setItem(KEY, save(notes))
  } catch {
    unsaved = true
  }
  state = { notes, unsaved }
  listeners.forEach((listener) => listener())
}

// The same notes open in another window: what is written there shows here.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return
  state = { notes: read(event.newValue), unsaved: false }
  listeners.forEach((listener) => listener())
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useNotes = (): State => useSyncExternalStore(subscribe, () => state)

export const notesStore = {
  write: (id: string, text: string) => set(write(state.notes, id, text, Date.now())),
  discard: (id: string) => set(discard(state.notes, id)),
  restore: (note: Note) => set(restore(state.notes, note)),
  /** A note put back with nothing on it is not kept. */
  tidy: () => set(tidy(state.notes)),
}

/** Is a note in hand right now? A new version of the app waits for it to be put back. */
export const hand = { busy: false }
