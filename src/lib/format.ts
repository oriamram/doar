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

/** The full date written on an opened envelope: "יום שלישי, 10 בנובמבר 2026 · 14:32". */
export function formatLetterDate(iso: string): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

/** The date quoted above an email you're answering: "10 בנובמבר 2026 בשעה 14:32". */
export function formatQuoteDate(iso: string): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
  const time = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  return `${day} בשעה ${time}`
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

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** The heading a date falls under in a list: today, yesterday, this week, this month, or a month's name. */
export function dayGroup(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return 'היום'
  if (days === 1) return 'אתמול'
  if (days < 7) return 'השבוע'
  const sameYear = date.getFullYear() === now.getFullYear()
  if (sameYear && date.getMonth() === now.getMonth()) return 'החודש'
  return date.toLocaleDateString('he-IL', { month: 'long', year: sameYear ? undefined : 'numeric' })
}

/** "340 KB", "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "מכתב אחד" / "3 מכתבים". */
export function countLetters(count: number): string {
  return count === 1 ? 'מכתב אחד' : `${count} מכתבים`
}
