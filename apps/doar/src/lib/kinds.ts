// Kinds of mail: what a letter is, read from its subject, its first words, its sender
// and its headers. A code is a queue ticket, a parcel is a delivery slip, a receipt is
// receipt paper, an invitation is a card, a leaflet is a leaflet; everything else is a
// letter. Detection goes from the surest sign to the weakest, and anything unsure stays
// a plain letter. Pure functions, checked by scripts/check-kinds.ts.

import { findCode } from '../../../../supabase/functions/postman/codes.ts'

export type Kind = 'code' | 'parcel' | 'receipt' | 'invitation' | 'leaflet' | 'letter'

export type ParcelStatus = 'way' | 'ready' | 'delivered' | 'problem'

/** A sum of money. The currency is kept the way it is shown: a sign ("₪", "$"), a word ("kr") or a code ("CHF"). */
export type Amount = { value: number; currency: string }

export type Shape =
  | { kind: 'code'; code: string }
  | { kind: 'parcel'; number: string | null; status: ParcelStatus | null }
  | { kind: 'receipt'; amount: Amount | null }
  | { kind: 'invitation' }
  | { kind: 'leaflet' }
  | { kind: 'letter' }

/** What is known about a letter when its kind is decided. */
export type Facts = {
  subject: string
  /** The letter's first words (in a list), or its whole text (when it is open). */
  text: string
  /** Mail you wrote yourself is always a letter. */
  outgoing?: boolean
  /** Sent to a mailing list: it says how to unsubscribe, or calls itself bulk mail. */
  bulk?: boolean
  /** Gmail sorted it under promotions. */
  promotion?: boolean
  /** It carries a calendar invitation (known once the letter is open). */
  calendar?: boolean
  /** Kinds the reader said this sender's mail is not. */
  not?: readonly Kind[]
}

export const LETTER: Shape = { kind: 'letter' }

// ---------- Invitations ----------

/** How Google Calendar titles its invitations: "הזמנה: ישיבת צוות @ יום ג׳…", "Invitation: Sync @ Tue…". */
const INVITATION = /^\s*(?:הזמנה(?:\s+מעודכנת)?|זימון|(?:updated\s+)?invitation(?:\s+from\s+[^:]{1,60})?)\s*:\s*\S.*\s@\s/i

// ---------- Parcels ----------

/** A specific parcel, not shipping in general: "החבילה שלך", "your order has shipped". */
const PARCEL_SUBJECT = [
  /(?:ה?חבילה|ה?משלוח|דבר\s+ה?דואר)\s+(?:שלך|שלכם|מספר|מס[׳'])/,
  /(?:ה?חבילה|ה?משלוח|ה?הזמנה)\s+\S{0,12}\s?(?:בדרך|נשלח|נמסר|יצא|הגיע|ממתינ|מחכ|מוכנ)/,
  /(?:ממתינ|מחכ|מוכנ)(?:ה|ים|ת)?\s+(?:לך\s+)?(?:לאיסוף|בנקודת)/,
  /(?:הודעה\s+על\s+(?:דבר\s+דואר|משלוח)|עדכון\s+(?:משלוח|מעקב)|מעקב\s+(?:משלוח|חבילה))/,
  /\byour\s+(?:package|parcel|order|shipment|delivery|item)\b.{0,40}\b(?:shipped|on\s+(?:its|the)\s+way|delivered|out\s+for\s+delivery|arriv|dispatched|ready|in\s+transit|delayed)/i,
  /\b(?:shipped|out\s+for\s+delivery|delivered|dispatched)\s*:/i,
  /\b(?:shipping|delivery|shipment|tracking)\s+(?:confirmation|update|notification)\b/i,
  /\b(?:package|parcel)\s+(?:is\s+)?(?:ready\s+for\s+pick-?up|awaiting\s+collection|has\s+arrived)/i,
]

/** Tracking numbers that say what they are by their form alone: international post, and UPS. */
const TRACKING_FORM = /\b([A-Z]{2}\d{9}[A-Z]{2}|1Z[0-9A-Z]{16})\b/
/** A tracking number named as one: "מספר מעקב: 7712345678". */
const TRACKING_NAMED = /(?:מספר\s+(?:ה?מעקב|ה?משלוח|ה?חבילה)|מס[׳']\s+(?:מעקב|משלוח)|tracking\s+(?:number|no\.?|id|#)|waybill|awb)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{7,29})\b/i
const DELIVERY_WORDS = /חבילה|משלוח|דבר\s+דואר|שליח|לאיסוף|package|parcel|shipment|deliver|courier|tracking/i

const STATUS: [ParcelStatus, RegExp][] = [
  ['problem', /עיכוב|מתעכב|לא\s+(?:הצלחנו|ניתן\s+היה)\s+למסור|ניסיון\s+מסירה|מכס|delay|could\s+not\s+be\s+delivered|delivery\s+attempt|failed\s+delivery|customs|held\s+at/i],
  ['delivered', /נמסר|נאספ|הגיע(?:ה)?\s+ליעד|delivered|was\s+collected|has\s+been\s+picked\s+up/i],
  ['ready', /(?:ממתינ|מחכ|מוכנ)(?:ה|ים|ת)?\s+(?:לך\s+)?(?:לאיסוף|בנקודת)|הגיע(?:ה)?\s+ל(?:נקודת|סניף|מרכז|לוקר)|ready\s+for\s+(?:pick-?up|collection)|awaiting\s+collection|arrived\s+at\s+(?:the\s+)?(?:pick-?up|post\s+office|locker)/i],
  ['way', /בדרך|נשלח|יצא(?:ה)?\s+(?:לדרך|למשלוח|אליך)|shipped|on\s+(?:its|the)\s+way|out\s+for\s+delivery|in\s+transit|dispatched/i],
]

export const STATUS_TEXT: Record<ParcelStatus, string> = {
  way: 'בדרך',
  ready: 'ממתינה לאיסוף',
  delivered: 'נמסרה',
  problem: 'מתעכבת',
}

function parcel(subject: string, text: string): Shape | null {
  const both = `${subject}\n${text}`
  const formed = TRACKING_FORM.exec(both)?.[1] ?? null
  const about = PARCEL_SUBJECT.some((pattern) => pattern.test(subject))
  // A tracking number by itself is a sign only beside words about a delivery.
  if (!about && !(formed && DELIVERY_WORDS.test(both))) return null
  const named = TRACKING_NAMED.exec(both)?.[1]
  const number = formed ?? (named && /\d{4}/.test(named) ? named : null)
  const status = STATUS.find(([, pattern]) => pattern.test(subject))?.[0] ?? STATUS.find(([, pattern]) => pattern.test(text))?.[0] ?? null
  return { kind: 'parcel', number, status }
}

// ---------- Receipts ----------

/** The paper itself is named in the subject ("הקבלה", but not "ההזמנה התקבלה"). */
const RECEIPT_PAPER = /(?<!\p{L})[הלבכומש]{0,2}(?:קבלה|חשבונית)(?!\p{L})|אישור\s+(?:תשלום|רכישה|עסקה)|\breceipt\b|\binvoice\b|payment\s+(?:confirmation|received|receipt)|\bpurchase\s+confirmation\b/iu
/** A weaker name: it counts only with an amount beside it. */
const RECEIPT_MAYBE = /אישור\s+הזמנה|ההזמנה\s+שלך|החשבון\s+(?:שלך|החודשי|לחודש|לתקופה)|תשלום\s+(?:התקבל|בוצע)|order\s+confirm|your\s+order|thanks?\s+for\s+your\s+(?:order|purchase|payment)|your\s+(?:bill|statement)|תודה\s+על\s+(?:הזמנתך|רכישתך|הקנייה|התשלום)/i

// A sum of money is a number with a currency beside it. Receipts come from everywhere, so
// the currency may be a sign ("₪", "$"), a word ("ש״ח", "kr") or a code ("ISK", "CHF"),
// before the number or after it, and the number may be written "1,249.90" or "1.249,90".

/** Signs. They stand before the number when shown (the shekel after it). */
const SIGNS: Record<string, string> = { '₪': '₪', $: '$', '€': '€', '£': '£', '¥': '¥', '₹': '₹', '₺': '₺', '฿': '฿', '₩': '₩', '₽': '₽' }
/** Words that name a currency in any case, and the way each is shown. They count only as whole words ("nis", not "tennis"). */
const WORDS: Record<string, string> = {
  'ש"ח': '₪',
  'ש״ח': '₪',
  'שח': '₪',
  nis: '₪',
  ils: '₪',
  usd: '$',
  'דולר': '$',
  eur: '€',
  'יורו': '€',
  'אירו': '€',
  gbp: '£',
  kr: 'kr',
  'zł': 'zł',
  'kč': 'Kč',
}
/** Codes that count only in capitals: "TRY" is a currency, "try" is a word. */
const CODES = ['ISK', 'SEK', 'NOK', 'DKK', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'THB', 'INR', 'KRW', 'AED', 'SAR', 'EGP', 'MXN', 'BRL', 'SGD', 'HKD', 'ZAR']

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SIGN = `[${Object.keys(SIGNS).map(literal).join('')}]`
/** A word or a code, with the full stop some write after it ("kr."). Longer ones first, so "kr" does not hide "krw". */
const WORD = `(?:${[...Object.keys(WORDS), ...CODES].sort((a, b) => b.length - a.length).map(literal).join('|')})\\.?`
/** Thousands divided by a comma, a dot or a thin space; decimals after a dot or a comma. */
const NUMBER = String.raw`\d{1,3}(?:[.,   ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const AMOUNT = new RegExp(
  // A sign with a number right after it belongs to that number: "2026 ₪11.90" is 11.90, not 2026.
  String.raw`(?:(?<s1>${SIGN}|(?<![\p{L}\d])${WORD})\s?(?<n1>${NUMBER})(?![\d%])|(?<![\d.,])(?<n2>${NUMBER})\s?(?<s2>${SIGN}(?!\d)|${WORD}(?![\p{L}\d])))`,
  'giu',
)
const TOTAL =
  /סה["״]כ|סך\s+הכל|סכום\s+(?:ל?תשלום|העסקה|החיוב|כולל)|לתשלום|שולם|חויב|\btotal\b|amount\s+(?:paid|due|charged)|grand\s+total|you\s+paid|\bsamtals\b|\bsumma\b|\bsumme\b|\bgesamt(?:betrag|summe)?\b/gi

/** How a currency is shown, from the way it was written; null when it is not one (a code in small letters). */
function currencyOf(written: string): string | null {
  const name = written.replace(/\.$/, '')
  return SIGNS[name] ?? WORDS[name.toLowerCase()] ?? (CODES.includes(name) ? name : null)
}

/** "1,249.90", "1.249,90" and "1 249,90" are one number; "12,5" is twelve and a half; "12.500" is twelve thousand five hundred. */
function numberOf(written: string): number {
  const text = written.replace(/[   ]/g, '')
  const last = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','))
  if (last < 0) return Number(text)
  const marks = text.replace(/\d/g, '')
  // The last mark sets off decimals when one or two digits follow it and it is not the mark that divides the thousands.
  const decimal = text.length - last - 1 <= 2 && (marks.length === 1 || marks.at(-1) !== marks.at(-2))
  const whole = (decimal ? text.slice(0, last) : text).replace(/[.,]/g, '')
  return Number(decimal ? `${whole}.${text.slice(last + 1)}` : whole)
}

/** Every sum of money written in a text, in order. */
function amounts(text: string): { at: number; amount: Amount }[] {
  const found: { at: number; amount: Amount }[] = []
  AMOUNT.lastIndex = 0
  for (let hit = AMOUNT.exec(text); hit; hit = AMOUNT.exec(text)) {
    const currency = currencyOf((hit.groups!.s1 ?? hit.groups!.s2)!)
    const value = numberOf((hit.groups!.n1 ?? hit.groups!.n2)!)
    if (currency && Number.isFinite(value) && value > 0) found.push({ at: hit.index, amount: { value, currency } })
  }
  return found
}

/** The sum a receipt is for: the one after "total" (the last such), else the largest written. */
export function findAmount(text: string): Amount | null {
  const all = amounts(text)
  if (all.length === 0) return null
  let afterTotal: Amount | null = null
  TOTAL.lastIndex = 0
  for (let hit = TOTAL.exec(text); hit; hit = TOTAL.exec(text)) {
    const end = hit.index + hit[0].length
    const next = all.find((item) => item.at >= end && item.at - end <= 40)
    if (next) afterTotal = next.amount
  }
  if (afterTotal) return afterTotal
  return all.reduce((best, item) => (item.amount.value > best.value ? item.amount : best), all[0]!.amount)
}

/**
 * A sum as it is shown. Shekels, dollars, euros and pounds always show their cents; other
 * currencies only when the sum has them ("884 kr", "¥1,200"). A currency written as a word
 * stands after the number, and the pair is read left to right even inside a Hebrew line.
 */
export function formatAmount(amount: Amount): string {
  const cents = ['₪', '$', '€', '£'].includes(amount.currency) || !Number.isInteger(amount.value)
  const text = amount.value.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })
  if (amount.currency === '₪') return `${text} ₪`
  if (SIGNS[amount.currency]) return `${amount.currency}${text}`
  return `⁦${text} ${amount.currency}⁩`
}

function receipt(subject: string, text: string): Shape | null {
  const paper = RECEIPT_PAPER.test(subject)
  if (!paper && !RECEIPT_MAYBE.test(subject)) return null
  const amount = findAmount(`${subject}\n${text}`)
  if (!paper && !amount) return null
  return { kind: 'receipt', amount }
}

// ---------- Deciding ----------

/** The Gmail search that gathers receipts and invoices of the last year (the receipts spike). */
export const RECEIPT_SEARCH =
  '{subject:קבלה subject:חשבונית subject:receipt subject:invoice subject:"אישור תשלום" subject:"אישור הזמנה" subject:"order confirmation"} -category:promotions -in:sent -in:drafts newer_than:1y'

/** What a letter is. Corrections (`not`) and "I wrote it" come first; then the surest sign wins. */
export function shapeOf(facts: Facts): Shape {
  if (facts.outgoing) return LETTER
  const allowed = (kind: Kind) => !facts.not?.includes(kind)
  const { subject, text } = facts

  if (allowed('invitation') && (facts.calendar || (!facts.promotion && INVITATION.test(subject)))) return { kind: 'invitation' }

  // A shop's coupon ("use code 2024") is not a code to type in, and its "free shipping" is not a parcel.
  if (!facts.promotion) {
    if (allowed('code')) {
      const code = findCode(subject, text)
      if (code) return { kind: 'code', code }
    }
    if (allowed('parcel')) {
      const found = parcel(subject, text)
      if (found) return found
    }
    if (allowed('receipt')) {
      const found = receipt(subject, text)
      if (found) return found
    }
  }

  if (allowed('leaflet') && (facts.bulk || facts.promotion)) return { kind: 'leaflet' }
  return LETTER
}

/** What a conversation in a list is, from what the list knows about it. */
export function threadShape(
  thread: { subject: string; snippet: string; outgoing: boolean; bulk: boolean; category: string; from: { email: string } },
  notKinds: Readonly<Record<string, readonly string[]>> = {},
): Shape {
  return shapeOf({
    subject: thread.subject,
    text: thread.snippet,
    outgoing: thread.outgoing,
    bulk: thread.bulk,
    promotion: thread.category === 'promotions',
    not: notKinds[thread.from.email.toLowerCase()] as Kind[] | undefined,
  })
}

/** A code is good for a short while; after that its ticket fades. */
export const CODE_FRESH_MS = 15 * 60_000
export const isFresh = (dateIso: string, now = Date.now()) => now - Date.parse(dateIso) < CODE_FRESH_MS

export const KIND_NAMES: Record<Exclude<Kind, 'letter'>, string> = {
  code: 'קוד',
  parcel: 'חבילה',
  receipt: 'קבלה',
  invitation: 'הזמנה',
  leaflet: 'עלון',
}

// ---------- Reading an invitation ----------

export type Invite = {
  title: string
  start: Date
  end: Date | null
  /** A whole day (or several), with no hours. */
  allDay: boolean
  location: string
  organizer: string
  /** The organizer called it off. */
  cancelled: boolean
}

/** The instant at which a clock in the zone `tz` shows this time. */
function zoned(year: number, month: number, day: number, hour: number, minute: number, second: number, tz: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second)
  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    const shown = (instant: number) => {
      const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]))
      return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!)
    }
    // Two rounds settle the hour around a daylight-saving change.
    let instant = wall - (shown(wall) - wall)
    instant = wall - (shown(instant) - instant)
    return new Date(instant)
  } catch {
    // A zone this device does not know (Outlook's own names): read the time as this device's.
    return new Date(year, month - 1, day, hour, minute, second)
  }
}

function icsDate(value: string, params: string): { date: Date; allDay: boolean } | null {
  const hit = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!hit) return null
  const [, y, m, d, hh, mm, ss, utc] = hit
  const n = (text: string | undefined) => Number(text ?? 0)
  if (hh === undefined) return { date: new Date(n(y), n(m) - 1, n(d)), allDay: true }
  if (utc) return { date: new Date(Date.UTC(n(y), n(m) - 1, n(d), n(hh), n(mm), n(ss))), allDay: false }
  const tz = /TZID=("?)([^";:]+)\1/i.exec(params)?.[2]
  return { date: tz ? zoned(n(y), n(m), n(d), n(hh), n(mm), n(ss), tz) : new Date(n(y), n(m) - 1, n(d), n(hh), n(mm), n(ss)), allDay: false }
}

const icsText = (value: string) => value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim()

/** The event inside a calendar file (.ics), or null when it holds none we can read. */
export function parseInvite(ics: string): Invite | null {
  // Long lines are folded onto the next line behind a space; put them back together.
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const begin = lines.findIndex((line) => /^BEGIN:VEVENT/i.test(line))
  if (begin < 0) return null
  const fields = new Map<string, { params: string; value: string }>()
  for (const line of lines.slice(begin + 1)) {
    if (/^END:VEVENT/i.test(line)) break
    // An alarm inside the event has fields of its own.
    if (/^BEGIN:/i.test(line)) break
    const hit = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line)
    if (hit && !fields.has(hit[1]!.toUpperCase())) fields.set(hit[1]!.toUpperCase(), { params: hit[2]!, value: hit[3]! })
  }
  const start = fields.get('DTSTART')
  const from = start && icsDate(start.value, start.params)
  if (!from) return null
  const finish = fields.get('DTEND')
  const to = finish ? icsDate(finish.value, finish.params) : null
  const organizer = fields.get('ORGANIZER')
  return {
    title: icsText(fields.get('SUMMARY')?.value ?? ''),
    start: from.date,
    end: to?.date ?? null,
    allDay: from.allDay,
    location: icsText(fields.get('LOCATION')?.value ?? ''),
    organizer: organizer ? icsText(/CN=("?)([^";:]+)\1/i.exec(organizer.params)?.[2] ?? organizer.value.replace(/^mailto:/i, '')) : '',
    cancelled: /^METHOD:CANCEL/im.test(ics) || /CANCELLED/i.test(fields.get('STATUS')?.value ?? ''),
  }
}

/** A link that opens Google Calendar with the event filled in, ready to save. */
export function calendarLink(invite: Invite): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = (date: Date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const instant = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const end = invite.end ?? new Date(invite.start.getTime() + (invite.allDay ? 86_400_000 : 3_600_000))
  const dates = invite.allDay ? `${day(invite.start)}/${day(end)}` : `${instant(invite.start)}/${instant(end)}`
  const params = new URLSearchParams({ action: 'TEMPLATE', text: invite.title || 'אירוע', dates })
  if (invite.location) params.set('location', invite.location)
  return `https://calendar.google.com/calendar/render?${params}`
}
