/** "14:05" for today, "3 בנוב׳" for this year, with the year otherwise. */
export function formatListDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('he-IL', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Text for a round postmark: "11.11" over the time (today), the weekday (this
 * week) or the year (older).
 */
export function postmark(iso: string): { top: string; bottom: string } {
  const date = new Date(iso)
  const now = new Date()
  const top = `${date.getDate()}.${date.getMonth() + 1}`
  let bottom: string
  if (date.toDateString() === now.toDateString()) {
    bottom = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } else if (now.getTime() - date.getTime() < 6 * 86_400_000) {
    bottom = date.toLocaleString('he-IL', { weekday: 'short' })
  } else {
    bottom = String(date.getFullYear())
  }
  return { top, bottom }
}

/** A stable small rotation per id, so each postmark sits a little crooked, like a real one. */
export function tilt(seed: string, max = 9): number {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return (Math.abs(hash) % (max * 2 + 1)) - max
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}
