// Opening hours: when notifications may arrive. Outside them the server holds
// notifications and sends one summary at opening time. Pure functions, used by the
// Edge Function and the app, and checked by scripts/check-postman.ts.

export type Hours = {
  /** "07:00" */
  from: string
  /** "22:00"; earlier than `from` means past midnight. */
  to: string
  /** Days that are open: 0 is Sunday, 6 is Saturday. */
  days: number[]
  /** Closed from the start of Shabbat on Friday until it ends on Saturday night. */
  shabbat: boolean
  /** The person's time zone, as the device names it ("Asia/Jerusalem"). */
  tz: string
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/
const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))

/** Opening hours as the app sent them, if they make sense. */
export function validHours(input: unknown): Hours | null {
  if (!input || typeof input !== 'object') return null
  const { from, to, days, shabbat, tz } = input as Record<string, unknown>
  if (typeof from !== 'string' || typeof to !== 'string' || !CLOCK.test(from) || !CLOCK.test(to)) return null
  if (!Array.isArray(days) || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null
  if (typeof tz !== 'string' || tz.length > 60) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    return null
  }
  return { from, to, days: [...new Set(days as number[])].sort(), shabbat: shabbat === true, tz }
}

type Local = { year: number; month: number; day: number; weekday: number; minutes: number; offset: number }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The date and time on the wall in a time zone, and how far that zone is from UTC (in minutes). */
export function localTime(at: Date, tz: string): Local {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0'
  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const offset = Math.round((wall - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000)
  return { year, month, day, weekday: WEEKDAYS.indexOf(get('weekday')), minutes: hour * 60 + minute, offset }
}

const rad = (degrees: number) => (degrees * Math.PI) / 180
const deg = (radians: number) => (radians * 180) / Math.PI
const wrap = (value: number, size: number) => ((value % size) + size) % size

/**
 * When the sun sets, in minutes after local midnight, for a date and a place
 * (the Almanac for Computers method; good to a minute or two).
 */
export function sunsetMinutes(year: number, month: number, day: number, latitude: number, longitude: number, offset: number): number {
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000)
  const lngHour = longitude / 15
  const t = dayOfYear + (18 - lngHour) / 24
  const anomaly = 0.9856 * t - 3.289
  const sun = wrap(anomaly + 1.916 * Math.sin(rad(anomaly)) + 0.02 * Math.sin(rad(2 * anomaly)) + 282.634, 360)
  let ascension = wrap(deg(Math.atan(0.91764 * Math.tan(rad(sun)))), 360)
  ascension = (ascension + Math.floor(sun / 90) * 90 - Math.floor(ascension / 90) * 90) / 15
  const sinDeclination = 0.39782 * Math.sin(rad(sun))
  const cosDeclination = Math.cos(Math.asin(sinDeclination))
  const cosHour = (Math.cos(rad(90.833)) - sinDeclination * Math.sin(rad(latitude))) / (cosDeclination * Math.cos(rad(latitude)))
  const hour = deg(Math.acos(Math.max(-1, Math.min(1, cosHour)))) / 15
  const utc = wrap(hour + ascension - 0.06571 * t - 6.622 - lngHour, 24)
  return wrap(Math.round(utc * 60) + offset, 1440)
}

/** Where sunset is measured for a time zone. Only Israel is known; elsewhere fixed evening hours stand in. */
const PLACES: Record<string, [number, number]> = { 'Asia/Jerusalem': [32.07, 34.78], 'Asia/Tel_Aviv': [32.07, 34.78] }

/** Shabbat comes in half an hour before sunset on Friday and goes out three quarters of an hour after sunset on Saturday. */
function isShabbat(now: Local, tz: string): boolean {
  if (now.weekday !== 5 && now.weekday !== 6) return false
  const place = PLACES[tz]
  const sunset = place ? sunsetMinutes(now.year, now.month, now.day, place[0], place[1], now.offset) : 18 * 60 + 30
  return now.weekday === 5 ? now.minutes >= sunset - 30 : now.minutes < sunset + 45
}

/** May a notification arrive at this moment? */
export function isOpen(hours: Hours, at: Date): boolean {
  const now = localTime(at, hours.tz)
  if (hours.shabbat && isShabbat(now, hours.tz)) return false
  if (!hours.days.includes(now.weekday)) return false
  const from = minutesOf(hours.from)
  const to = minutesOf(hours.to)
  if (from === to) return true
  return from < to ? now.minutes >= from && now.minutes < to : now.minutes >= from || now.minutes < to
}
