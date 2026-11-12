import type { Contact } from '../types'

/** Decode RFC 2047 encoded words ("=?UTF-8?B?...?="), which some mail leaves in its headers. */
export function decodeWords(value: string): string {
  if (!value.includes('=?')) return value
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(?:\s+(?==\?))?/g, (whole, charset: string, mode: string, text: string) => {
    try {
      const binary =
        mode.toLowerCase() === 'b'
          ? atob(text)
          : text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      return new TextDecoder(charset).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
    } catch {
      return whole
    }
  })
}

/** "Maya Levi <maya@example.com>" → { name: 'Maya Levi', email: 'maya@example.com' } */
export function parseContact(value: string): Contact {
  const text = decodeWords(value).trim()
  const match = text.match(/^"?((?:[^"\\]|\\.)*?)"?\s*<([^>]+)>$/)
  if (match) {
    const email = match[2]!.trim()
    const name = match[1]!.replace(/\\(.)/g, '$1').trim()
    return { name: name || email, email }
  }
  const email = text.replace(/^<|>$/g, '')
  return { name: email, email }
}

/** Split a To/Cc header into contacts; commas inside quoted names don't split. */
export function parseAddressList(value: string): Contact[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let angle = false
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    if (char === '\\' && quoted) {
      current += char + (value[++i] ?? '')
      continue
    }
    if (char === '"') quoted = !quoted
    else if (char === '<' && !quoted) angle = true
    else if (char === '>' && !quoted) angle = false
    if ((char === ',' || char === ';') && !quoted && !angle) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts
    .filter((part) => part.trim())
    .map(parseContact)
    .filter((contact) => isEmail(contact.email))
}

export function isEmail(text: string): boolean {
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(text)
}

export const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Drop repeats (by address), keeping the first of each. */
export function uniqueContacts(contacts: Contact[]): Contact[] {
  const seen = new Set<string>()
  return contacts.filter((contact) => {
    const key = contact.email.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A short name for lists: "Maya Levi", or the part before @ when there's no name. */
export function shortName(contact: Contact): string {
  if (contact.name && contact.name !== contact.email) return contact.name
  return contact.email.split('@')[0] ?? contact.email
}
