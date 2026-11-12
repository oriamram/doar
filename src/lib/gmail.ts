import type { Attachment, Category, Contact, Label, Message, Thread } from '../types'
import { decodeWords, parseAddressList, parseContact } from './addresses'
import { clearGoogleAccessToken, getGoogleAccessToken } from './googleToken'
import { base64UrlToBytes } from './mime'

/**
 * Gmail REST API client. Calls go straight from this device to Google;
 * emails never pass through our own server.
 * Docs: https://developers.google.com/gmail/api/reference/rest
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me'

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
  threadId: string
  labelIds?: string[]
  snippet: string
  internalDate: string
  payload: GmailPart
}
type GmailThread = { id: string; historyId: string; messages: GmailMessage[] }
type GmailDraft = { id: string; message: GmailMessage }

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

async function gmail<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}, attempt = 0): Promise<T> {
  const token = await getGoogleAccessToken()
  let response: Response
  try {
    response = await fetch(path.startsWith('https://') ? path : `${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new GmailError(0, 'אין חיבור לאינטרנט. נסו שוב כשהרשת תחזור.')
  }
  if (response.ok) {
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

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
    throw new GmailError(response.status, 'Gmail ביקש שנאט קצת. נסו שוב בעוד דקה.')
  }
  let message = `הבקשה ל־Gmail נכשלה (${response.status}).`
  try {
    message = JSON.parse(body).error?.message ?? message
  } catch {
    // Not JSON; keep the generic message.
  }
  throw new GmailError(response.status, message)
}

// ---------- Lists ----------

/** What to list: Gmail labels, a Gmail search, or both. */
export type ListQuery = { labelIds?: string[]; q?: string; includeSpamTrash?: boolean }

export type ThreadPage = { threads: Thread[]; nextPageToken?: string }

/**
 * Conversations we already know, by id. A list request returns each thread's
 * `historyId`, which changes whenever the thread does; unchanged threads are
 * served from here, so refreshing a list usually costs a single request.
 */
const threadCache = new Map<string, Thread>()

export function seedThreads(threads: Thread[]) {
  for (const thread of threads) if (!threadCache.has(thread.id)) threadCache.set(thread.id, thread)
}

/** Keep a local change (say, marked read) in the cache until Gmail reports the thread changed. */
export function patchCachedThread(thread: Thread) {
  threadCache.set(thread.id, thread)
}

const LIST_HEADERS = ['From', 'To', 'Subject', 'Content-Type'].map((h) => `metadataHeaders=${h}`).join('&')

export async function listThreads(query: ListQuery, pageToken?: string, maxResults = 25): Promise<ThreadPage> {
  const params = new URLSearchParams({ maxResults: String(maxResults) })
  for (const label of query.labelIds ?? []) params.append('labelIds', label)
  if (query.q) params.set('q', query.q)
  if (query.includeSpamTrash) params.set('includeSpamTrash', 'true')
  if (pageToken) params.set('pageToken', pageToken)

  const list = await gmail<{ threads?: { id: string; snippet: string; historyId: string }[]; nextPageToken?: string }>(
    `/threads?${params}`,
  )
  // Each thread we don't know costs a request; a few at a time keeps us well under Gmail's limits.
  const threads = await mapLimit(list.threads ?? [], 6, async (item) => {
    const cached = threadCache.get(item.id)
    if (cached && cached.historyId === item.historyId) return cached
    const thread = toThread(await gmail<GmailThread>(`/threads/${item.id}?format=metadata&${LIST_HEADERS}`), item.snippet)
    threadCache.set(thread.id, thread)
    return thread
  })
  return { threads, nextPageToken: list.nextPageToken }
}

/** Unread and total conversation counts for a label (say, INBOX or DRAFT). */
/** One conversation by its id (say, from a notification), whether or not a list has loaded it. */
export async function getThread(id: string): Promise<Thread> {
  const raw = await gmail<GmailThread>(`/threads/${id}?format=metadata&${LIST_HEADERS}`)
  const thread = toThread(raw, raw.messages.at(-1)?.snippet ?? '')
  threadCache.set(thread.id, thread)
  return thread
}

export async function labelStats(labelId: string): Promise<{ unread: number; total: number }> {
  const label = await gmail<{ threadsUnread?: number; threadsTotal?: number }>(`/labels/${labelId}`)
  return { unread: label.threadsUnread ?? 0, total: label.threadsTotal ?? 0 }
}

// ---------- Reading a conversation ----------

type LoadedMessages = { historyId: string; messages: Message[] }
const messageCache = new Map<string, LoadedMessages>()
const messageLoads = new Map<string, Promise<LoadedMessages>>()

/** Messages we already hold for a conversation, if they're still current. */
export function peekMessages(thread: Pick<Thread, 'id' | 'historyId'>): Message[] | null {
  const cached = messageCache.get(thread.id)
  // History ids are big counters sent as text; what we hold is good if it's at least as new.
  return cached && BigInt(cached.historyId) >= BigInt(thread.historyId) ? cached.messages : null
}

export async function loadMessages(thread: Pick<Thread, 'id' | 'historyId'>): Promise<Message[]> {
  const cached = peekMessages(thread)
  if (cached) return cached
  let load = messageLoads.get(thread.id)
  if (!load) {
    load = gmail<GmailThread>(`/threads/${thread.id}?format=full`)
      .then((full) => {
        const loaded = { historyId: full.historyId, messages: full.messages.map(toMessage) }
        messageCache.set(thread.id, loaded)
        // Keep memory in check: only the most recently opened conversations stay.
        if (messageCache.size > 60) messageCache.delete(messageCache.keys().next().value!)
        return loaded
      })
      .finally(() => messageLoads.delete(thread.id))
    messageLoads.set(thread.id, load)
  }
  return (await load).messages
}

/** Forget a conversation's messages (after sending a reply or saving a draft in it). */
export function forgetMessages(threadId: string) {
  messageCache.delete(threadId)
}

const attachmentCache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>()

/** The bytes of a file attached to an email. */
export function getAttachmentBytes(file: Pick<Attachment, 'messageId' | 'attachmentId' | 'data'>): Promise<Uint8Array<ArrayBuffer>> {
  if (file.data) return Promise.resolve(base64UrlToBytes(file.data))
  const key = `${file.messageId}:${file.attachmentId}`
  let bytes = attachmentCache.get(key)
  if (!bytes) {
    bytes = gmail<{ data: string }>(`/messages/${file.messageId}/attachments/${file.attachmentId}`).then((result) =>
      base64UrlToBytes(result.data),
    )
    attachmentCache.set(key, bytes)
    bytes.catch(() => attachmentCache.delete(key))
    if (attachmentCache.size > 40) attachmentCache.delete(attachmentCache.keys().next().value!)
  }
  return bytes
}

// ---------- Actions ----------

export function modifyThread(id: string, addLabelIds: string[], removeLabelIds: string[]) {
  return gmail(`/threads/${id}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  })
}

export const trashThread = (id: string) => gmail(`/threads/${id}/trash`, { method: 'POST' })
export const untrashThread = (id: string) => gmail(`/threads/${id}/untrash`, { method: 'POST' })

// ---------- Labels ----------

type GmailLabel = { id: string; name: string; type: string; color?: { backgroundColor?: string } }

const toLabel = (label: GmailLabel): Label => ({
  id: label.id,
  name: label.name,
  type: label.type === 'user' ? 'user' : 'system',
  color: label.color?.backgroundColor,
})

/** The labels you made in Gmail, alphabetically. */
export async function listLabels(): Promise<Label[]> {
  const result = await gmail<{ labels?: GmailLabel[] }>('/labels')
  return (result.labels ?? [])
    .filter((label) => label.type === 'user')
    .map(toLabel)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
}

export async function createLabel(name: string): Promise<Label> {
  const label = await gmail<GmailLabel>('/labels', {
    method: 'POST',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  })
  return toLabel(label)
}

// ---------- Drafts and sending ----------

/** Raw emails up to this size go in a JSON request; bigger ones use Gmail's upload address. */
const JSON_LIMIT = 3_000_000

const toBase64Url = (ascii: string) => btoa(ascii).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function upload(meta: object, raw: string): { body: Blob; headers: Record<string, string> } {
  const boundary = `doar_upload_${crypto.randomUUID()}`
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`,
    raw,
    `\r\n--${boundary}--`,
  ])
  return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } }
}

/** Save an email being written to Gmail's Drafts (creating or replacing the draft). */
export async function saveDraft(raw: string, threadId?: string, draftId?: string): Promise<{ id: string; messageId: string }> {
  const message = threadId ? { threadId } : {}
  const method = draftId ? 'PUT' : 'POST'
  const path = draftId ? `/drafts/${draftId}` : '/drafts'
  try {
    const draft =
      raw.length <= JSON_LIMIT
        ? await gmail<GmailDraft>(path, { method, body: JSON.stringify({ message: { ...message, raw: toBase64Url(raw) } }) })
        : await gmail<GmailDraft>(`${UPLOAD}${path}?uploadType=multipart`, { method, ...upload({ message }, raw) })
    return { id: draft.id, messageId: draft.message.id }
  } catch (error) {
    // The draft was deleted elsewhere (say, in Gmail itself): save it as a new one.
    if (draftId && error instanceof GmailError && error.status === 404) return saveDraft(raw, threadId)
    throw error
  }
}

/** Who a draft is for and what it's about, for the list of letters waiting to be sent. */
export async function draftInfo(draftId: string): Promise<{ to: Contact[]; subject: string; snippet: string; message: Message }> {
  const draft = await gmail<GmailDraft>(`/drafts/${draftId}?format=full`)
  const message = toMessage(draft.message)
  return { to: [...message.to, ...message.cc, ...message.bcc], subject: message.subject, snippet: draft.message.snippet, message }
}

export const deleteDraft = (draftId: string) => gmail(`/drafts/${draftId}`, { method: 'DELETE' })

export function sendDraft(draftId: string) {
  return gmail<{ id: string; threadId: string }>('/drafts/send', { method: 'POST', body: JSON.stringify({ id: draftId }) })
}

/**
 * Send a draft in a way that survives the page closing: used when the app is
 * hidden or closed while "undo send" is still counting down.
 */
export function sendDraftOnExit(draftId: string, token: string) {
  void fetch(`${API}/drafts/send`, {
    method: 'POST',
    keepalive: true,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: draftId }),
  })
}

/** Send a small email right away, with no draft (used for unsubscribe requests). */
export function sendRaw(raw: string) {
  return gmail('/messages/send', { method: 'POST', body: JSON.stringify({ raw: toBase64Url(raw) }) })
}

/** Which draft holds which message: message id → draft id. */
export async function listDraftIds(): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  let pageToken: string | undefined
  do {
    const page = await gmail<{ drafts?: { id: string; message: { id: string } }[]; nextPageToken?: string }>(
      `/drafts?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
    )
    for (const draft of page.drafts ?? []) ids.set(draft.message.id, draft.id)
    pageToken = page.nextPageToken
  } while (pageToken && ids.size < 500)
  return ids
}

/** People you recently wrote to, for suggesting recipients. */
export async function recentRecipients(max = 40) {
  const list = await gmail<{ messages?: { id: string }[] }>(`/messages?q=${encodeURIComponent('in:sent')}&maxResults=${max}`)
  const messages = await mapLimit(list.messages ?? [], 5, ({ id }) =>
    gmail<GmailMessage>(`/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`),
  )
  return messages.flatMap((message) => [
    ...parseAddressList(header(message.payload, 'To')),
    ...parseAddressList(header(message.payload, 'Cc')),
  ])
}

// ---------- Parsing ----------

function header(part: GmailPart, name: string): string {
  const lower = name.toLowerCase()
  return part.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
}

const CATEGORY_LABELS: Record<string, Category> = {
  CATEGORY_PERSONAL: 'primary',
  CATEGORY_PROMOTIONS: 'promotions',
  CATEGORY_SOCIAL: 'social',
  CATEGORY_UPDATES: 'updates',
  CATEGORY_FORUMS: 'forums',
}

function toThread(thread: GmailThread, snippet: string): Thread {
  const has = (message: GmailMessage, label: string) => message.labelIds?.includes(label) ?? false
  const sent = thread.messages.filter((message) => !has(message, 'DRAFT'))
  const shown = sent.length ? sent : thread.messages
  const first = shown[0]!
  const last = shown.at(-1)!
  // Mail you sent carries the SENT label; the list shows the other side of the conversation.
  const incoming = shown.findLast((message) => !has(message, 'SENT') && !has(message, 'DRAFT'))
  const recipient = parseAddressList(header(last.payload, 'To'))[0] ?? { name: '', email: '' }

  let category: Category = 'primary'
  for (const message of shown.toReversed()) {
    const label = message.labelIds?.find((id) => id in CATEGORY_LABELS)
    if (label) {
      category = CATEGORY_LABELS[label]!
      break
    }
  }

  return {
    id: thread.id,
    historyId: thread.historyId,
    from: incoming ? parseContact(header(incoming.payload, 'From')) : recipient,
    outgoing: !incoming,
    subject: decodeWords(header(first.payload, 'Subject')) || '(ללא נושא)',
    snippet: decodeEntities(snippet),
    date: new Date(Number(last.internalDate)).toISOString(),
    unread: thread.messages.some((message) => has(message, 'UNREAD')),
    starred: thread.messages.some((message) => has(message, 'STARRED')),
    messageCount: sent.length,
    labelIds: [...new Set(thread.messages.flatMap((message) => message.labelIds ?? []))],
    // The list request carries no file details; a "mixed" email is almost always one with files.
    hasAttachment: thread.messages.some((message) => /^multipart\/mixed/i.test(header(message.payload, 'Content-Type'))),
    hasDraft: thread.messages.some((message) => has(message, 'DRAFT')),
    category,
  }
}

function toMessage(message: GmailMessage): Message {
  const { payload } = message
  const html = findPart(payload, 'text/html')
  const text = findPart(payload, 'text/plain')
  const bodyText = text ? decodePart(text) : html ? htmlToText(decodePart(html)) : ''
  const attachments: Attachment[] = []
  collectAttachments(payload, message.id, attachments)

  const unsubscribe = header(payload, 'List-Unsubscribe')
  const unsubscribeUrl = unsubscribe.match(/<(https:\/\/[^>]+)>/i)?.[1]
  const unsubscribeMailto = unsubscribe.match(/<mailto:([^>]+)>/i)?.[1]

  return {
    id: message.id,
    threadId: message.threadId,
    from: parseContact(header(payload, 'From')),
    to: parseAddressList(header(payload, 'To')),
    cc: parseAddressList(header(payload, 'Cc')),
    bcc: parseAddressList(header(payload, 'Bcc')),
    replyTo: parseAddressList(header(payload, 'Reply-To')),
    subject: decodeWords(header(payload, 'Subject')),
    date: new Date(Number(message.internalDate)).toISOString(),
    snippet: decodeEntities(message.snippet),
    bodyHtml: html ? decodePart(html) : textToHtml(bodyText),
    bodyText,
    attachments,
    labelIds: message.labelIds ?? [],
    isDraft: message.labelIds?.includes('DRAFT') ?? false,
    messageIdHeader: header(payload, 'Message-ID'),
    inReplyTo: header(payload, 'In-Reply-To'),
    references: header(payload, 'References'),
    unsubscribe: unsubscribeUrl || unsubscribeMailto ? { url: unsubscribeUrl, mailto: unsubscribeMailto } : undefined,
  }
}

/** Find the first body part of a type, skipping attached files. */
function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found) return found
  }
  return undefined
}

/** Everything in the email that is a file: real attachments and images placed in the body. */
function collectAttachments(part: GmailPart, messageId: string, found: Attachment[]) {
  const contentId = header(part, 'Content-ID').replace(/^<|>$/g, '')
  const isBodyText = (part.mimeType === 'text/html' || part.mimeType === 'text/plain') && !part.filename
  const hasBytes = part.body?.attachmentId || (part.body?.data && (part.filename || contentId))
  if (!isBodyText && hasBytes && !part.mimeType.startsWith('multipart/')) {
    const extension = part.mimeType.split('/')[1]?.split(/[+;]/)[0] ?? 'bin'
    found.push({
      key: `${messageId}:${found.length}`,
      messageId,
      attachmentId: part.body!.attachmentId,
      data: part.body!.attachmentId ? undefined : part.body!.data,
      filename: decodeWords(part.filename ?? '') || `קובץ-${found.length + 1}.${extension}`,
      mimeType: part.mimeType,
      size: part.body!.size,
      contentId: contentId || undefined,
    })
  }
  for (const child of part.parts ?? []) collectAttachments(child, messageId, found)
}

/**
 * Gmail sends bodies as base64url bytes in the part's declared charset. Senders
 * often mislabel UTF-8 as windows-1255 or iso-8859-8, which turns Hebrew into
 * gibberish. Bytes that are valid UTF-8 almost never come from those encodings,
 * so like Gmail we trust the bytes over the label.
 */
function decodePart(part: GmailPart): string {
  const bytes = base64UrlToBytes(part.body!.data!)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Not UTF-8: use the declared charset.
  }
  const charset = header(part, 'Content-Type').match(/charset="?([^";\s]+)/i)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
  return `<div style="white-space: pre-wrap">${linked}</div>`
}

/** The readable text of an HTML email (parsed, never run). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('style, script, head, title').forEach((element) => element.remove())
  doc.querySelectorAll('br').forEach((element) => element.replaceWith('\n'))
  doc.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, blockquote').forEach((element) => element.append('\n'))
  return (doc.body.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Snippets come HTML-escaped ("&#39;"); turn them back into plain text. */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
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
