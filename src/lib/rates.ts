// How much of each currency one shekel buys today, to add up subscriptions paid in
// dollars, euros and shekels as one sum. From the European Central Bank's daily rates
// (api.frankfurter.dev: free, no key, asked only for the rates, nothing about the person).
// Kept on the device for half a day.

import { isDemo, storageKey } from './demo'

const KEY = storageKey('doar:rates')
const FRESH_MS = 12 * 3600_000

export type Rates = { rates: Record<string, number>; date: string }

/** Rates for the demo, so it needs no network and its sums stay the same. */
const DEMO: Rates = { rates: { USD: 0.3, EUR: 0.28, GBP: 0.24 }, date: '2026-11-18' }

export async function shekelRates(): Promise<Rates | null> {
  if (isDemo) return DEMO
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Rates & { at: number }) | null
    if (kept && Date.now() - kept.at < FRESH_MS) return kept
  } catch {
    // Nothing usable kept; ask again.
  }
  try {
    const answer = await fetch('https://api.frankfurter.dev/v1/latest?base=ILS', { signal: AbortSignal.timeout(8000) })
    if (!answer.ok) return null
    const body = (await answer.json()) as { rates?: Record<string, number>; date?: string }
    if (!body.rates) return null
    const rates: Rates = { rates: body.rates, date: body.date ?? '' }
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...rates, at: Date.now() }))
    } catch {
      // Not kept; asked again next time.
    }
    return rates
  } catch {
    return null
  }
}
