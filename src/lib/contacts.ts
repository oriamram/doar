import type { Contact } from '../types'
import { isEmail } from './addresses'
import { recentRecipients } from './gmail'

/**
 * People you exchange mail with, gathered from the mail itself and kept on this
 * device, so the "To" field can suggest addresses as you type.
 */

type Known = Contact & { score: number }

const KEY = 'doar:contacts'
const HARVEST_KEY = 'doar:contacts:harvested'
const MAX = 600
const ROBOT = /no-?reply|do-?not-?reply|mailer-daemon|notifications?@|bounce|postmaster/i

let known = new Map<string, Known>()
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Known[]
  known = new Map(saved.map((contact) => [contact.email.toLowerCase(), contact]))
} catch {
  // Nothing saved yet.
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function saveSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const top = [...known.values()].sort((a, b) => b.score - a.score).slice(0, MAX)
    try {
      localStorage.setItem(KEY, JSON.stringify(top))
    } catch {
      // Storage is full or blocked; suggestions just won't survive a restart.
    }
  }, 1500)
}

/** Note these people. People you write to count for more than people who write to you. */
export function rememberContacts(contacts: Contact[], weight = 1) {
  let changed = false
  for (const contact of contacts) {
    if (!isEmail(contact.email) || ROBOT.test(contact.email)) continue
    const key = contact.email.toLowerCase()
    const existing = known.get(key)
    const hasName = contact.name && contact.name !== contact.email
    if (existing) {
      existing.score += weight
      if (hasName && existing.name === existing.email) existing.name = contact.name
    } else {
      known.set(key, { name: contact.name, email: contact.email, score: weight })
    }
    changed = true
  }
  if (changed) saveSoon()
}

/** Contacts matching what's typed, best first. */
export function suggestContacts(typed: string, exclude: Contact[], limit = 5): Contact[] {
  const query = typed.trim().toLowerCase()
  if (!query) return []
  const taken = new Set(exclude.map((contact) => contact.email.toLowerCase()))
  const matches: { contact: Known; rank: number }[] = []
  for (const contact of known.values()) {
    if (taken.has(contact.email.toLowerCase())) continue
    const name = contact.name.toLowerCase()
    const email = contact.email.toLowerCase()
    const starts = name.startsWith(query) || email.startsWith(query) || name.split(/\s+/).some((word) => word.startsWith(query))
    if (starts) matches.push({ contact, rank: 2 })
    else if (name.includes(query) || email.includes(query)) matches.push({ contact, rank: 1 })
  }
  return matches
    .sort((a, b) => b.rank - a.rank || b.contact.score - a.contact.score)
    .slice(0, limit)
    .map(({ contact }) => ({ name: contact.name, email: contact.email }))
}

/** Once a day, learn who you recently wrote to from the Sent folder. */
export async function harvestRecipients() {
  const last = Number(localStorage.getItem(HARVEST_KEY) ?? 0)
  if (Date.now() - last < 24 * 3_600_000) return
  try {
    rememberContacts(await recentRecipients(), 3)
    localStorage.setItem(HARVEST_KEY, String(Date.now()))
  } catch {
    // Not important enough to bother anyone; try again next time.
  }
}
