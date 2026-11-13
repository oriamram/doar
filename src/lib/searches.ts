import { storageKey } from './demo'

/** The last few things you searched for, kept on this device and offered again under the search box. */

const KEY = storageKey('doar:searches')
const MAX = 6

export function recentSearches(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

export function rememberSearch(query: string) {
  const text = query.trim()
  if (!text) return
  const next = [text, ...recentSearches().filter((item) => item !== text)].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage is full or blocked; the search itself still works.
  }
}

export function forgetSearches() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to remove.
  }
}
