// Tickets: what lets a button on a notification act on one conversation without a
// sign-in. The server signs a small note (who, which conversation, until when) and
// sends it inside the notification; when a button is pressed, the service worker
// hands the note back, and the server checks its own signature. Checked by
// scripts/check-postman.ts.

import { b64url, fromB64url } from './webpush.ts'

export type Ticket = {
  /** The person. */
  u: string
  /** The conversation. */
  t: string
  /** Good until (milliseconds since 1970). */
  e: number
  /** For reminders: which kind this was, so "remind me again" can make another like it. */
  k?: 'hold' | 'reply'
  /** For registered mail: how many days to wait, and the sent message an answer is awaited to. */
  d?: number
  m?: string
}

const encoder = new TextEncoder()

async function hmac(text: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)))
}

export async function signTicket(ticket: Ticket, secret: string): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(ticket)))
  return `${body}.${b64url(await hmac(body, secret))}`
}

/** The ticket's contents if the signature is ours and its time has not passed; otherwise null. */
export async function readTicket(text: unknown, secret: string, now = Date.now()): Promise<Ticket | null> {
  if (typeof text !== 'string' || text.length > 2000) return null
  const [body, signature, extra] = text.split('.')
  if (!body || !signature || extra !== undefined) return null
  try {
    const expected = await hmac(body, secret)
    const given = fromB64url(signature)
    if (given.length !== expected.length) return null
    let difference = 0
    for (let i = 0; i < given.length; i++) difference |= given[i]! ^ expected[i]!
    if (difference !== 0) return null
    const ticket = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Ticket
    if (typeof ticket.u !== 'string' || typeof ticket.t !== 'string' || typeof ticket.e !== 'number' || ticket.e < now) return null
    return ticket
  } catch {
    return null
  }
}
