// The home-screen widget on an Android phone (the app in widget/).
//
// The widget has no sign-in of its own. Connecting it from Doar's settings makes a long
// random key; the server keeps only the key's fingerprint (SHA-256), and Doar hands the
// key itself to the widget app on the same phone. With it the widget can ask for one
// thing: the latest letters in the inbox (who, subject, when, read or not). It cannot
// open a letter, send, file or delete. Disconnecting it in Settings deletes the key.
//
// Pure functions, checked by scripts/check-postman.ts.

import { b64url } from './webpush.ts'
import { findCode, formatCode } from './codes.ts'
import { clip, decodeWords, plain, senderName } from './text.ts'

/** One conversation as the widget shows it. */
export type WidgetLetter = {
  thread: string
  /** Who wrote it: the last message that was not sent by the person. */
  from: string
  subject: string
  /** The first words of the newest message. */
  preview: string
  /** When the newest message arrived (milliseconds since 1970). */
  at: number
  unread: boolean
  starred: boolean
  /** How many messages the conversation has. */
  count: number
  /** A one-time code in an unread letter, written the way it is read out ("482 913"). */
  code: string | null
}

type Message = {
  labelIds?: string[]
  internalDate?: string
  snippet?: string
  payload?: { headers?: { name: string; value: string }[] }
}

const header = (message: Message | undefined, name: string): string =>
  message?.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? ''

/** A conversation from Gmail (format=metadata) as the widget shows it; null when it has no messages. */
export function widgetLetter(thread: { id: string; messages?: Message[] }): WidgetLetter | null {
  const messages = thread.messages ?? []
  const last = messages.at(-1)
  if (!last) return null
  const received = [...messages].reverse().find((message) => !(message.labelIds ?? []).includes('SENT')) ?? last
  const subject = decodeWords(header(messages[0], 'subject')).replace(/\s+/g, ' ').trim()
  const preview = plain(last.snippet ?? '')
  const unread = messages.some((message) => message.labelIds?.includes('UNREAD'))
  const code = unread ? findCode(subject, preview) : null
  return {
    thread: thread.id,
    from: clip(senderName(header(received, 'from')) || 'שולח לא ידוע', 40),
    subject: clip(subject || '(בלי נושא)', 120),
    preview: clip(preview, 140),
    at: Number(received.internalDate ?? last.internalDate) || 0,
    unread,
    starred: messages.some((message) => message.labelIds?.includes('STARRED')),
    count: messages.length,
    code: code ? formatCode(code) : null,
  }
}

/** The kinds of mail Doar ties into bundles (src/lib/views.ts). */
const BUNDLED = ['updates', 'promotions', 'social', 'forums']

/**
 * The Gmail search for the letters on the widget: the inbox as Doar's desk shows it,
 * so with bundles on (the default) updates, advertising and social mail stay out.
 */
export function widgetQuery(bundles: boolean, unreadOnly = false): string {
  const parts = ['in:inbox']
  if (unreadOnly) parts.push('is:unread')
  if (bundles) parts.push(...BUNDLED.map((category) => `-category:${category}`))
  return parts.join(' ')
}

/** A new widget key: 32 random bytes, written so it fits in a link. */
export function newWidgetKey(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** Is this something a widget key could be? (43 link-safe characters.) */
export const validWidgetKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)

/** What the server keeps instead of the key: its SHA-256, in hex. */
export async function widgetKeyHash(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
