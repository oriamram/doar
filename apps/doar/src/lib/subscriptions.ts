// Subscriptions: what keeps charging you, gathered from the receipts in the mail.
//
// A receipt is part of a subscription when it says so (a plan, "subscription", "renews",
// "monthly", a billing period such as "Nov 12–Dec 12, 2026"), or when the same sender
// charges again and again at a steady pace with about the same sum. The person can correct
// both ways ("זה לא מנוי", "זה מנוי"). Pure functions, checked by scripts/check-subscriptions.ts.

import { findAmount, type Amount } from './kinds.ts'

export type Period = 'week' | 'month' | 'quarter' | 'year'

export const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30.44, quarter: 91.31, year: 365.25 }
export const PERIOD_NAMES: Record<Period, string> = { week: 'שבועי', month: 'חודשי', quarter: 'רבעוני', year: 'שנתי' }

const DAY = 86_400_000

/** One receipt, as far as subscriptions care. */
export type Charge = {
  thread: string
  /** When it was charged (the letter's time, milliseconds since 1970). */
  at: number
  /** Who charges: the sender's own site ("anthropic.com"), plus the plan for app stores. */
  key: string
  /** How the sender is called, without "Inc." and "בע״מ". */
  name: string
  /** What was paid. */
  amount: Amount | null
  /** The plan's own price when the receipt lists it apart from credits and refunds. */
  price: Amount | null
  /** "Claude Max", "iCloud+ with 200 GB of storage". */
  plan: string | null
  /** The period the letter names, if any. */
  period: Period | null
  /** The letter speaks of a subscription. */
  recurring: boolean
}

export type Letter = { thread: string; at: number; from: { name: string; email: string }; subject: string; text: string; receipt: boolean }

// ---------- Reading one letter ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = String.raw`(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?`
/** A billing period as Stripe and others write it: "Nov 12–Dec 12, 2026", "Dec 28, 2025 – Jan 28, 2026". */
const RANGE = new RegExp(String.raw`\b${MONTH}\s(\d{1,2})(?:,\s(\d{4}))?\s?[–—-]\s?${MONTH}\s(\d{1,2}),\s(\d{4})`, 'i')
/** The line that follows a period on such receipts: the plan, its quantity and its price. */
// Up to 200 characters: some plans carry notes ("(10000 credits / month) - monthly subscription (organization ID: …)").
const LINE_AFTER = /^\s*(.{2,200}?)\s+Qty\s+\d+\s+(\S+(?:\s?\S+)?)/i

const MONTHLY = /\((?:monthly|חודשי)\)|\bmonthly\b|\bper\s+month\b|\/\s?(?:mo|month)\b|\bevery\s+month\b|חודשי(?:ת)?(?![א-ת])|לחודש(?![א-ת])|כל\s+חודש/i
// "\b" does not see Hebrew letters as letters; "(?![א-ת])" ends a Hebrew word instead.
const YEARLY = /\((?:yearly|annual|שנתי)\)|\b(?:yearly|annually|annual\s+(?:plan|subscription|membership|billing))\b|\bper\s+year\b|\/\s?(?:yr|year)\b|\bevery\s+year\b|(?:מנוי|תשלום|חיוב)\s+שנתי|לשנה(?![א-ת])/i
const QUARTERLY = /\bquarterly\b|\bevery\s+3\s+months\b|רבעוני/i
const WEEKLY = /\bweekly\b|\bper\s+week\b|\/\s?(?:wk|week)\b|שבועי(?:ת)?(?![א-ת])/i

/** Words that say the charge is part of a subscription. */
const RECURRING =
  /\bsubscriptions?\b|\bsubscribed\b|\brenews?\b|\brenewal\b|\brenewed\b|\brecurring\b|\bmembership\b|\bauto-?renew|\bbilling\s+period\b|\bnext\s+(?:billing|payment|charge)\b|\b(?:pro|plus|premium|max|basic|standard|family|team|business|starter|core)\s+plan\b|\bplan\s+[-–]\s|מנוי|חידוש|הוראת\s+קבע|חיוב\s+(?:חודשי|שנתי|חוזר|קבוע)|תשלום\s+(?:חודשי|קבוע|חוזר)/i

/** Said by a letter that tells of a charge that happened (and not of one to come). */
const PAID = /\bpaid\b|\bcharged\b|\breceipt\b|\binvoice\b|payment\s+(?:received|successful|confirmed|confirmation)|thank\s+you\s+for\s+your\s+payment|חויב|שולם|התשלום\s+(?:התקבל|בוצע)|קבלה|חשבונית/i

/** Senders that charge for many things: each plan of theirs is a subscription of its own. */
const STORES = new Set(['apple.com', 'google.com', 'paypal.com', 'microsoft.com', 'amazon.com'])

/** "mail.anthropic.com" → "anthropic.com"; "service.bezeq.co.il" → "bezeq.co.il". */
export function siteOf(email: string): string {
  const host = email.slice(email.lastIndexOf('@') + 1).toLowerCase().trim()
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const second = parts.at(-2)!
  const keep = parts.at(-1)!.length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'org', 'ltd', 'muni'].includes(second) ? 3 : 2
  return parts.slice(-keep).join('.')
}

/** A company's name without its legal ending: "Anthropic, PBC" → "Anthropic". */
export function plainName(name: string): string {
  return (
    name
      .replace(/^["']|["']$/g, '')
      .replace(/[,\s]+(?:inc\.?|incorporated|ltd\.?|limited|llc|l\.l\.c\.|pbc|gmbh|s\.a\.|b\.v\.|corp\.?|co\.|plc|ag)$/i, '')
      .replace(/\s+בע["״]?מ\.?$/, '')
      .trim() || name
  )
}

function periodFromWords(text: string): Period | null {
  if (MONTHLY.test(text)) return 'month'
  if (YEARLY.test(text)) return 'year'
  if (QUARTERLY.test(text)) return 'quarter'
  if (WEEKLY.test(text)) return 'week'
  return null
}

/** The period a number of days stands for, when it is near one. */
export function periodOfDays(days: number): Period | null {
  if (days >= 6 && days <= 8) return 'week'
  if (days >= 26 && days <= 35) return 'month'
  if (days >= 85 && days <= 97) return 'quarter'
  if (days >= 350 && days <= 380) return 'year'
  return null
}

/** What one letter says, or null when it is not a charge (a reminder of one to come, an advertisement). */
export function readCharge(letter: Letter): Charge | null {
  const text = `${letter.subject}\n${letter.text}`
  if (!letter.receipt && !PAID.test(text)) return null
  const amount = findAmount(text)
  if (!amount) return null

  let period = periodFromWords(text)
  let plan: string | null = null
  let price: Amount | null = null
  const range = RANGE.exec(text)
  if (range) {
    const [, fromMonth, fromDay, fromYear, toMonth, toDay, toYear] = range
    const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase())
    const end = Date.UTC(Number(toYear), month(toMonth!), Number(toDay))
    const startYear = fromYear ? Number(fromYear) : month(fromMonth!) > month(toMonth!) ? Number(toYear) - 1 : Number(toYear)
    const start = Date.UTC(startYear, month(fromMonth!), Number(fromDay))
    period = periodOfDays((end - start) / DAY) ?? period
    const line = LINE_AFTER.exec(text.slice(range.index + range[0].length))
    if (line) {
      plan = line[1]!.trim()
      price = findAmount(line[2]!)
    }
  }
  if (!plan) {
    // "iCloud+ with 200 GB of storage (Monthly)": the words before the period in brackets.
    // Only words on the same line: the subject above it is not part of the plan.
    const named = /((?:\S+[^\S\n]){0,5}\S+)[^\S\n]*\((?:monthly|yearly|annual|weekly|חודשי|שנתי)\)/i.exec(text)
    if (named) plan = named[1]!.trim()
  }

  // "Automate Core plan (10000 credits / month) - monthly subscription" is the "Automate Core plan".
  if (plan) plan = plan.split(/\s+[-–(]\s?/)[0]!.trim() || null
  const site = siteOf(letter.from.email)
  let name = plainName(letter.from.name || site.split('.')[0]!)
  // A receipt sent for a brand by the company behind it ("Celonis Inc." for Make): the plan names the brand.
  const brand = site.split('.')[0]!
  if (!name.toLowerCase().includes(brand) && plan?.toLowerCase().startsWith(`${brand} `)) name = plan.slice(0, brand.length)
  const store = STORES.has(site) && plan
  return {
    thread: letter.thread,
    at: letter.at,
    key: store ? `${site}/${plan!.toLowerCase()}` : site,
    // An app store's plans are told apart by the plan written under the name, not in it.
    name,
    amount,
    price,
    plan,
    period,
    recurring: !!range || !!period || RECURRING.test(text),
  }
}

// ---------- Many letters ----------

export type Subscription = {
  key: string
  name: string
  plan: string | null
  period: Period | null
  /** What one period costs now: the plan's price, else the last sum paid. */
  price: Amount | null
  /** That price for one month. */
  monthly: Amount | null
  lastAt: number
  /** When the next charge is due, if the period is known. */
  nextAt: number | null
  /** Still charging: the last charge is no older than one and a half periods. */
  active: boolean
  /** Paid in the last twelve months, per currency. */
  year: Amount[]
  /** Its receipts, newest first. */
  charges: Charge[]
  /** Why it counts: the letters say so, the pace says so, or the person said so. */
  because: 'letters' | 'pace' | 'you'
}

export type Overrides = { add: string[]; drop: string[] }

/** Sums of money added up per currency. */
export function addUp(amounts: (Amount | null)[]): Amount[] {
  const sums: Amount[] = []
  for (const amount of amounts) {
    if (!amount) continue
    const sum = sums.find((item) => item.currency === amount.currency)
    if (sum) sum.value = Math.round((sum.value + amount.value) * 100) / 100
    else sums.push({ ...amount })
  }
  return sums
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** The same receipt sent twice (a copy a day later, an invoice and then its receipt): one charge. */
function withoutCopies(charges: Charge[]): Charge[] {
  const kept: Charge[] = []
  for (const charge of [...charges].sort((a, b) => a.at - b.at)) {
    const copy = kept.find(
      (other) =>
        Math.abs(other.at - charge.at) < 3 * DAY &&
        other.amount?.currency === charge.amount?.currency &&
        Math.abs((other.amount?.value ?? 0) - (charge.amount?.value ?? 0)) < 0.01,
    )
    if (!copy) kept.push(charge)
  }
  return kept
}

/** The steady pace of a sender's charges, if there is one: at least two gaps, all near the same period, and sums within a fifth of each other. */
function steadyPace(charges: Charge[]): Period | null {
  if (charges.length < 3) return null
  const gaps = charges.slice(1).map((charge, index) => (charge.at - charges[index]!.at) / DAY)
  const period = periodOfDays(median(gaps))
  if (!period || gaps.some((gap) => periodOfDays(gap) !== period)) return null
  const values = charges.map((charge) => charge.amount?.value ?? 0)
  const currencies = new Set(charges.map((charge) => charge.amount?.currency))
  if (currencies.size > 1 || Math.max(...values) > Math.min(...values) * 1.2) return null
  return period
}

function perMonth(price: Amount | null, period: Period | null): Amount | null {
  if (!price || !period) return null
  const value = (price.value * PERIOD_DAYS.month) / PERIOD_DAYS[period]
  return { value: Math.round(value * 100) / 100, currency: price.currency }
}

/** Every subscription in these charges, the active ones first, then by what they cost; and the other senders who charged more than once. */
export function gather(all: Charge[], now: number, overrides: Overrides = { add: [], drop: [] }) {
  const groups = new Map<string, Charge[]>()
  for (const charge of all) groups.set(charge.key, [...(groups.get(charge.key) ?? []), charge])

  const subscriptions: Subscription[] = []
  const others: { key: string; name: string; charges: Charge[] }[] = []
  for (const [key, group] of groups) {
    const charges = withoutCopies(group)
    const newest = charges.at(-1)!
    const said = charges.some((charge) => charge.recurring)
    const pace = steadyPace(charges)
    const because = overrides.drop.includes(key) ? null : overrides.add.includes(key) ? 'you' : said ? 'letters' : pace ? 'pace' : null
    if (!because) {
      if (charges.length >= 2 || overrides.drop.includes(key)) others.push({ key, name: newest.name, charges: [...charges].reverse() })
      continue
    }
    // The newest letter that names a period, else the pace, else the gaps between charges.
    const gaps = charges.slice(1).map((charge, index) => (charge.at - charges[index]!.at) / DAY)
    const period = [...charges].reverse().find((charge) => charge.period)?.period ?? pace ?? (gaps.length ? periodOfDays(median(gaps)) : null)
    const price = [...charges].reverse().find((charge) => charge.price)?.price ?? newest.amount
    const days = period ? PERIOD_DAYS[period] : null
    subscriptions.push({
      key,
      name: newest.name,
      plan: [...charges].reverse().find((charge) => charge.plan)?.plan ?? null,
      period,
      price,
      monthly: perMonth(price, period),
      lastAt: newest.at,
      nextAt: days ? newest.at + days * DAY : null,
      // Without a known period, a charge in the last six weeks still counts as running.
      active: now - newest.at <= (days ? days * 1.5 + 3 : 45) * DAY,
      year: addUp(charges.filter((charge) => now - charge.at <= 365 * DAY).map((charge) => charge.amount)),
      charges: [...charges].reverse(),
      because,
    })
  }
  subscriptions.sort((a, b) => Number(b.active) - Number(a.active) || (b.monthly?.value ?? 0) - (a.monthly?.value ?? 0) || b.lastAt - a.lastAt)
  others.sort((a, b) => b.charges.length - a.charges.length)
  return { subscriptions, others }
}

/** The Gmail search for the letters a subscription may be in: receipts, and letters about plans and renewals, of the last thirteen months. */
export const SUBSCRIPTION_SEARCH =
  '{subject:קבלה subject:חשבונית subject:receipt subject:invoice subject:"אישור תשלום" subject:subscription subject:מנוי subject:renewal subject:renewed subject:חידוש subject:"your plan" subject:membership subject:payment subject:billing subject:charged subject:חיוב} -in:sent -in:drafts newer_than:13m'

// ---------- Money in shekels ----------

/** The currency codes behind the signs Doar shows; "kr" could be four currencies, so it has none. */
export const ISO: Record<string, string> = { '₪': 'ILS', $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₺': 'TRY', '฿': 'THB', '₩': 'KRW', 'zł': 'PLN', Kč: 'CZK' }

/**
 * Sums in several currencies as one sum in shekels, given how many of each currency one
 * shekel buys. Null when a currency has no known rate.
 */
export function inShekels(sums: Amount[], rates: Record<string, number>): number | null {
  let total = 0
  for (const sum of sums) {
    const code = ISO[sum.currency] ?? sum.currency
    if (code === 'ILS') total += sum.value
    else if (rates[code]) total += sum.value / rates[code]
    else return null
  }
  return Math.round(total * 100) / 100
}
