import type { Contact, Message, Thread } from '../types'
import { clearGoogleAccessToken, getGoogleAccessToken } from './googleToken'

/**
 * Minimal Gmail REST API client. Calls go straight from this device to Google;
 * emails never pass through our own server.
 * Docs: https://developers.google.com/gmail/api/reference/rest
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

type GmailHeader = { name: string; value: string }
type GmailPart = {
  mimeType: string
  filename?: string
  headers?: GmailHeader[]
  body?: { data?: string; size: number; attachmentId?: string }
  parts?: GmailPart[]
}
type GmailMessage = {
  id: string
  labelIds?: string[]
  snippet: string
  internalDate: string
  payload: GmailPart
}
type GmailThread = { id: string; messages: GmailMessage[] }

/** A Gmail error with a message fit to show the user. */
export class GmailError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Gmail signals "slow down" with 429, or 403 and a rate-limit reason. */
function isRateLimited(status: number, body: string) {
  return status === 429 || (status === 403 && /rateLimitExceeded|RATE_LIMIT_EXCEEDED|userRateLimit/i.test(body))
}

async function gmail<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await getGoogleAccessToken()
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (response.ok) return response.json() as Promise<T>

  const body = await response.text()
  if (response.status === 401 && attempt === 0) {
    // The access token expired early; get a fresh one and try once more.
    clearGoogleAccessToken()
    return gmail(path, init, attempt + 1)
  }
  if (isRateLimited(response.status, body)) {
    // Back off and retry: 1s, 2s, 4s, 8s (plus a little jitter).
    if (attempt < 4) {
      await sleep(1000 * 2 ** attempt + Math.random() * 300)
      return gmail(path, init, attempt + 1)
    }
    throw new GmailError(response.status, 'Gmail ביקש שנאט קצת. נסה שוב בעוד דקה.')
  }
  let message = `הבקשה ל־Gmail נכשלה (${response.status}).`
  try {
    message = JSON.parse(body).error?.message ?? message
  } catch {
    // Not JSON; keep the generic message.
  }
  throw new GmailError(response.status, message)
}

// ---------- Reading ----------

export async function listInbox(maxResults = 30): Promise<Thread[]> {
  const list = await gmail<{ threads?: { id: string; snippet: string }[] }>(
    `/threads?labelIds=INBOX&maxResults=${maxResults}`,
  )
  // Each thread costs a request; a few at a time keeps us well under Gmail's per-minute limit.
  return mapLimit(list.threads ?? [], 5, async ({ id, snippet }) => {
    const thread = await gmail<GmailThread>(
      `/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    )
    return toThread(thread, snippet)
  })
}

export async function getThreadMessages(threadId: string): Promise<Message[]> {
  const thread = await gmail<GmailThread>(`/threads/${threadId}?format=full`)
  return thread.messages.map(toMessage)
}

// ---------- Actions ----------

function modifyThread(id: string, addLabelIds: string[], removeLabelIds: string[]) {
  return gmail(`/threads/${id}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  })
}

export const archiveThread = (id: string) => modifyThread(id, [], ['INBOX'])
export const setThreadUnread = (id: string, unread: boolean) =>
  unread ? modifyThread(id, ['UNREAD'], []) : modifyThread(id, [], ['UNREAD'])
export const setThreadStarred = (id: string, starred: boolean) =>
  starred ? modifyThread(id, ['STARRED'], []) : modifyThread(id, [], ['STARRED'])

// ---------- Parsing ----------

function header(part: GmailPart, name: string): string {
  const lower = name.toLowerCase()
  return part.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
}

/** "Maya Levi <maya@example.com>" → { name: 'Maya Levi', email: 'maya@example.com' } */
export function parseContact(value: string): Contact {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (match) {
    const email = match[2]!.trim()
    return { name: match[1]!.trim() || email, email }
  }
  const email = value.trim()
  return { name: email, email }
}

function toThread(thread: GmailThread, snippet: string): Thread {
  const first = thread.messages[0]!
  const last = thread.messages.at(-1)!
  const hasLabel = (label: string) => thread.messages.some((m) => m.labelIds?.includes(label))
  return {
    id: thread.id,
    from: parseContact(header(last.payload, 'From')),
    subject: header(first.payload, 'Subject') || '(ללא נושא)',
    snippet: decodeEntities(snippet),
    date: new Date(Number(last.internalDate)).toISOString(),
    unread: hasLabel('UNREAD'),
    starred: hasLabel('STARRED'),
    messageCount: thread.messages.length,
  }
}

function toMessage(message: GmailMessage): Message {
  return {
    id: message.id,
    from: parseContact(header(message.payload, 'From')),
    to: header(message.payload, 'To'),
    date: new Date(Number(message.internalDate)).toISOString(),
    snippet: decodeEntities(message.snippet),
    bodyHtml: extractBody(message.payload),
  }
}

/** Find the first body part of a type, skipping attachments. */
function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found) return found
  }
  return undefined
}

function extractBody(payload: GmailPart): string {
  const html = findPart(payload, 'text/html')
  if (html) return decodePart(html)
  const text = findPart(payload, 'text/plain')
  if (text) return textToHtml(decodePart(text))
  return ''
}

/** Gmail sends bodies as base64url bytes in the part's own charset. */
function decodePart(part: GmailPart): string {
  const charset = header(part, 'Content-Type').match(/charset="?([^";\s]+)/i)?.[1] ?? 'utf-8'
  const binary = atob(part.body!.data!.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
  return `<div style="white-space: pre-wrap">${linked}</div>`
}

/** Snippets come HTML-escaped ("&#39;"); turn them back into plain text. */
function decodeEntities(text: string): string {
  return new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? text
}

/** Run `fn` over `items` with at most `limit` running at once, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
