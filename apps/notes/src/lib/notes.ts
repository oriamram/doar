// What a note is, and the few things that can happen to one. Pure functions, checked by
// scripts/check-notes.ts. The copy the app keeps on the device is in store.ts.

export type Note = {
  id: string
  text: string
  /** When it was first written, and when it was last written on (milliseconds since 1970). */
  createdAt: number
  updatedAt: number
}

/** The most that fits on one slip. */
export const MAX_LENGTH = 4000

/**
 * Write on a note. The first words written on a fresh slip are what make it a note;
 * a slip with nothing on it is not kept.
 */
export function write(notes: Note[], id: string, text: string, now: number): Note[] {
  const clipped = text.slice(0, MAX_LENGTH)
  const existing = notes.find((note) => note.id === id)
  if (!existing) return clipped.trim() ? [...notes, { id, text: clipped, createdAt: now, updatedAt: now }] : notes
  if (existing.text === clipped) return notes
  return notes.map((note) => (note.id === id ? { ...note, text: clipped, updatedAt: now } : note))
}

/** Throw a note away. */
export const discard = (notes: Note[], id: string): Note[] => notes.filter((note) => note.id !== id)

/** Bring a thrown note back. It lies where it lay: its place comes from when it was last written on. */
export const restore = (notes: Note[], note: Note): Note[] => (notes.some((other) => other.id === note.id) ? notes : [...notes, note])

/** Slips with nothing written on them are not notes. */
export const tidy = (notes: Note[]): Note[] => (notes.some((note) => note.text.trim() === '') ? notes.filter((note) => note.text.trim() !== '') : notes)

/** The order on the desk: the note written on last lies first. */
export const arranged = (notes: Note[]): Note[] => [...notes].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)

/** How the notes are saved on the device. */
export const save = (notes: Note[]): string => JSON.stringify({ version: 1, notes })

/** What was saved, read back with care: whatever is not a note is left out. */
export function read(saved: string | null): Note[] {
  if (!saved) return []
  try {
    const parsed = JSON.parse(saved) as { notes?: unknown }
    if (!Array.isArray(parsed?.notes)) return []
    const seen = new Set<string>()
    const notes: Note[] = []
    for (const item of parsed.notes as Partial<Note>[]) {
      if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.text !== 'string') continue
      const updatedAt = Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : 0
      const createdAt = Number.isFinite(item.createdAt) ? Number(item.createdAt) : updatedAt
      seen.add(item.id)
      notes.push({ id: item.id, text: item.text.slice(0, MAX_LENGTH), createdAt, updatedAt })
    }
    return notes
  } catch {
    return []
  }
}

/** A small tilt for each slip, the same every time for the same note: between -1.6 and 1.6 degrees. */
export function tilt(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.round(((Math.abs(hash) % 33) / 10 - 1.6) * 10) / 10
}

/** "פתק אחד", "3 פתקים". */
export const countLabel = (count: number): string => (count === 1 ? 'פתק אחד' : `${count} פתקים`)

const DAY = 86_400_000
const startOfDay = (at: number) => {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
const two = (value: number) => String(value).padStart(2, '0')

/** The day a note was last written on, the short way: "היום", "אתמול", "12.11", and "12.11.25" for another year. */
export function dayLabel(at: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY)
  if (days <= 0) return 'היום'
  if (days === 1) return 'אתמול'
  const date = new Date(at)
  const short = `${date.getDate()}.${date.getMonth() + 1}`
  return date.getFullYear() === new Date(now).getFullYear() ? short : `${short}.${two(date.getFullYear() % 100)}`
}

/** The same with the hour, for the note in hand: "היום 10:05", "12.11 14:20". */
export function whenLabel(at: number, now: number): string {
  const date = new Date(at)
  return `${dayLabel(at, now)} ${two(date.getHours())}:${two(date.getMinutes())}`
}
