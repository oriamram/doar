import type { Contact } from '../types'

/**
 * Stamp colors after "Doar Ivri" (1948), Israel's first stamps: ancient coins,
 * each value printed in its own color (orange, green, red-purple, red,
 * ultramarine, brown), plus a petrol of our own.
 */
const STAMP_COLORS = ['#c2571a', '#2f6b3c', '#8b2f63', '#b3312b', '#24407a', '#6e4a2e', '#1f5f5b']

/** A small stable number for a piece of text, for picking colors. */
export function hash(text: string): number {
  let h = 0
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) | 0
  return Math.abs(h)
}

/** Each sender always gets the same stamp color. */
export function stampColor(contact: Contact): string {
  return STAMP_COLORS[hash((contact.email || contact.name).toLowerCase()) % STAMP_COLORS.length]!
}

/** First letter or digit of a name ("“Maya” Levi" → "M", "מאיה" → "מ"). */
export function stampLetter(name: string): string {
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '·').toUpperCase()
}
