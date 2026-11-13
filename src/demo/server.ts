import { validHours, type Hours } from '../../supabase/functions/postman/hours.ts'
import { replyState, validDays, validDue } from '../../supabase/functions/postman/reminders.ts'
import { labelsFor, matches, normalizeMatch, senderAddress, type Rule } from '../../supabase/functions/postman/rules.ts'
import { decodeWords, parseAddressList } from '../lib/addresses'
import { DEMO_ME, demoFast } from '../lib/demo'
import { base64UrlToBytes } from '../lib/mime'
import { buildMailbox, makeMessage, toUrl64, type DemoLabel, type DemoMessage, type Header, type Part } from './data'

/**
 * A stand-in for Gmail and for Doar's own server, running inside the page.
 *
 * The app above it is unchanged: it builds the same addresses, sends the same
 * requests and reads the same answers. Only the last step, the network, is
 * replaced by `demoFetch` (Gmail's API) and `demoPostman` (Doar's server).
 */

const API_PATH = '/gmail/v1/users/me'
const UPLOAD_PATH = '/upload/gmail/v1/users/me'
const DAY = 86_400_000

const box = buildMailbox()
let history = Math.max(...box.messages.map((message) => message.historyId))
let nextMessage = 1
let nextDraft = 1
let nextLabel = 10
let nextThread = 1
let nextFile = 1

/** Draft id to the id of the message it holds. */
const drafts = new Map<string, string>()
for (const message of box.messages) if (message.labelIds.includes('DRAFT')) drafts.set(`r${nextDraft++}`, message.id)

const wait = () => (demoFast ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, 60 + Math.random() * 120)))

const json = (body?: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const missing = () => json({ error: { code: 404, message: 'Requested entity was not found.' } }, 404)
const refused = (message: string, status = 400) => json({ error: { code: status, message } }, status)

const header = (message: DemoMessage, name: string) =>
  message.payload.headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? ''
const inThread = (id: string) => box.messages.filter((message) => message.threadId === id).sort((a, b) => a.internalDate - b.internalDate)
const threadHistory = (list: DemoMessage[]) => String(Math.max(...list.map((message) => message.historyId)))
const touch = (message: DemoMessage) => {
  message.historyId = ++history
}
const hidden = (message: DemoMessage) => message.labelIds.includes('SPAM') || message.labelIds.includes('TRASH')

function hasFiles(part: Part): boolean {
  return (!!part.filename && !!part.body.attachmentId) || (part.parts ?? []).some(hasFiles)
}

// ---------- Search ----------

type Test = (message: DemoMessage) => boolean

const PLACES: Record<string, string> = { inbox: 'INBOX', sent: 'SENT', draft: 'DRAFT', drafts: 'DRAFT', spam: 'SPAM', trash: 'TRASH', chats: 'CHAT' }

/** One word of a Gmail search ("in:inbox", "from:dana", "חוזה"). */
function term(operator: string, raw: string): Test {
  const value = raw.replace(/^[("]+|[)"]+$/g, '').toLowerCase()
  const people = (message: DemoMessage) => `${header(message, 'To')} ${header(message, 'Cc')}`.toLowerCase()
  switch (operator) {
    case 'in':
      return value === 'anywhere' ? () => true : (message) => message.labelIds.includes(PLACES[value] ?? value.toUpperCase())
    case 'is':
      if (value === 'unread') return (message) => message.labelIds.includes('UNREAD')
      if (value === 'read') return (message) => !message.labelIds.includes('UNREAD')
      if (value === 'starred') return (message) => message.labelIds.includes('STARRED')
      return () => true
    case 'category': {
      const label = value === 'primary' ? 'CATEGORY_PERSONAL' : `CATEGORY_${value.toUpperCase()}`
      return (message) => message.labelIds.includes(label)
    }
    case 'label': {
      const label = box.labels.find((item) => item.name.toLowerCase() === value || item.id.toLowerCase() === value)
      return (message) => !!label && message.labelIds.includes(label.id)
    }
    case 'from':
      return value === 'me'
        ? (message) => message.labelIds.includes('SENT') || message.labelIds.includes('DRAFT')
        : (message) => header(message, 'From').toLowerCase().includes(value)
    case 'to':
      return value === 'me' ? (message) => people(message).includes(DEMO_ME.email) : (message) => people(message).includes(value)
    case 'subject':
      return (message) => decodeWords(header(message, 'Subject')).toLowerCase().includes(value)
    case 'has':
      return value === 'attachment' ? (message) => hasFiles(message.payload) : () => true
    case 'newer_than':
    case 'older_than': {
      const unit = value.endsWith('m') ? 30 * DAY : value.endsWith('y') ? 365 * DAY : DAY
      const edge = Date.now() - (parseInt(value, 10) || 0) * unit
      return operator === 'newer_than' ? (message) => message.internalDate >= edge : (message) => message.internalDate < edge
    }
    default:
      return (message) => message.search.includes(operator ? `${operator}:${value}` : value)
  }
}

/** A Gmail search as a test for one message. Words are "and"; OR joins the words on its two sides; "-" negates. */
function compile(query: string): Test {
  const groups: Test[][] = []
  let either = false
  for (const token of query.match(/-?(?:\w+:)?(?:\([^)]*\)|"[^"]*"|[^\s()]+)/g) ?? []) {
    if (token === 'OR') {
      either = true
      continue
    }
    const negative = token.startsWith('-')
    const body = negative ? token.slice(1) : token
    const split = /^(\w+):(.*)$/.exec(body)
    const plain = split ? term(split[1]!.toLowerCase(), split[2]!) : term('', body)
    const test: Test = negative ? (message) => !plain(message) : plain
    if (either && groups.length) groups.at(-1)!.push(test)
    else groups.push([test])
    either = false
  }
  return (message) => groups.every((group) => group.some((test) => test(message)))
}

function found(params: URLSearchParams): DemoMessage[] {
  const query = params.get('q') ?? ''
  const labels = params.getAll('labelIds')
  const everything = params.get('includeSpamTrash') === 'true' || /\bin:(spam|trash|anywhere)\b/i.test(query)
  const test = compile(query)
  return box.messages.filter((message) => (everything || !hidden(message)) && labels.every((label) => message.labelIds.includes(label)) && test(message))
}

function page<T>(items: T[], params: URLSearchParams): { items: T[]; next?: string } {
  const size = Number(params.get('maxResults') ?? 100)
  const start = Number(params.get('pageToken') ?? 0)
  return { items: items.slice(start, start + size), next: start + size < items.length ? String(start + size) : undefined }
}

// ---------- Answers in Gmail's shape ----------

function shape(message: DemoMessage, format: string, wanted: string[]) {
  const base = {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    snippet: message.snippet,
    internalDate: String(message.internalDate),
    historyId: String(message.historyId),
  }
  if (format === 'minimal') return base
  if (format === 'metadata') {
    const names = wanted.map((name) => name.toLowerCase())
    const headers = message.payload.headers.filter((item) => names.length === 0 || names.includes(item.name.toLowerCase()))
    return { ...base, payload: { mimeType: message.payload.mimeType, headers } }
  }
  return { ...base, payload: message.payload }
}

function relabel(list: DemoMessage[], add: string[] = [], remove: string[] = []): Response | null {
  const unknown = add.find((id) => !box.labels.some((label) => label.id === id))
  if (unknown) return refused(`Invalid label: ${unknown}`)
  for (const message of list) {
    message.labelIds = [...new Set([...message.labelIds.filter((label) => !remove.includes(label)), ...add])]
    touch(message)
  }
  return null
}

function labelCounts(label: DemoLabel) {
  const with_ = box.messages.filter((message) => message.labelIds.includes(label.id) && (label.id === 'SPAM' || label.id === 'TRASH' || !hidden(message)))
  const unread = with_.filter((message) => message.labelIds.includes('UNREAD'))
  const threads = (list: DemoMessage[]) => new Set(list.map((message) => message.threadId)).size
  return { ...label, messagesTotal: with_.length, messagesUnread: unread.length, threadsTotal: threads(with_), threadsUnread: threads(unread) }
}

// ---------- Letters written in the demo ----------

function fileName(type: string, disposition: string): string | undefined {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  if (star) {
    try {
      return decodeURIComponent(star)
    } catch {
      return star
    }
  }
  return /filename="([^"]*)"/i.exec(disposition)?.[1] ?? (disposition ? /name="([^"]*)"/i.exec(type)?.[1] : undefined)
}

/** Read the raw email the app builds (src/lib/mime.ts) back into Gmail's parts. */
function parseEntity(source: string): Part {
  const cut = source.indexOf('\r\n\r\n')
  const head = cut < 0 ? source : source.slice(0, cut)
  const body = cut < 0 ? '' : source.slice(cut + 4)
  const headers: Header[] = head
    .replace(/\r\n[ \t]+/g, ' ')
    .split('\r\n')
    .filter((line) => line.includes(':'))
    .map((line) => ({ name: line.slice(0, line.indexOf(':')), value: line.slice(line.indexOf(':') + 1).trim() }))
  const get = (name: string) => headers.find((item) => item.name.toLowerCase() === name)?.value ?? ''
  const type = get('content-type') || 'text/plain'
  const mimeType = type.split(';')[0]!.trim().toLowerCase()
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1]
  if (boundary) {
    const pieces = body.split(`--${boundary}`).slice(1, -1)
    return { mimeType, headers, body: { size: 0 }, parts: pieces.map((piece) => parseEntity(piece.replace(/^\r\n/, '').replace(/\r\n$/, ''))) }
  }
  let base64 = body.replace(/\s+/g, '')
  if (get('content-transfer-encoding').toLowerCase() !== 'base64') {
    try {
      base64 = btoa(body)
    } catch {
      base64 = ''
    }
  }
  const data = toUrl64(base64)
  const size = Math.floor((base64.length * 3) / 4)
  const filename = fileName(type, get('content-disposition'))
  if (filename) {
    const attachmentId = `sent-${nextFile++}`
    box.files.set(attachmentId, data)
    return { mimeType, filename, headers, body: { attachmentId, size } }
  }
  return { mimeType, headers, body: { data, size } }
}

function findPart(part: Part, mimeType: string): Part | undefined {
  if (part.mimeType === mimeType && part.body.data && !part.filename) return part
  for (const child of part.parts ?? []) {
    const hit = findPart(child, mimeType)
    if (hit) return hit
  }
  return undefined
}

function fromRaw(raw: string, threadId: string | undefined, labels: string[]): DemoMessage {
  const payload = parseEntity(raw)
  const id = `w${nextMessage++}`
  const get = (name: string) => payload.headers.find((item) => item.name.toLowerCase() === name)?.value ?? ''
  const textPart = findPart(payload, 'text/plain')
  const text = textPart?.body.data ? new TextDecoder().decode(base64UrlToBytes(textPart.body.data)) : ''
  payload.headers.push({ name: 'Date', value: new Date().toUTCString() }, { name: 'Message-ID', value: `<${id}@doar.example>` })
  return {
    id,
    threadId: threadId ?? `t-new-${nextThread++}`,
    labelIds: labels,
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 170),
    internalDate: Date.now(),
    historyId: ++history,
    payload,
    search: [decodeWords(get('subject')), decodeWords(get('from')), decodeWords(get('to')), text].join(' ').toLowerCase(),
  }
}

/** Mail that arrives while the demo is open goes through the same steps Doar's server takes. */
function arrive(message: DemoMessage) {
  onArrival(message)
  const add = labelsFor(server.rules, header(message, 'From')).filter((id) => box.labels.some((label) => label.id === id))
  message.labelIds.push(...add.filter((id) => !message.labelIds.includes(id)))
  box.messages.push(message)
  window.dispatchEvent(new Event('doar-demo-mail'))
}

/** People in the demo answer a letter a few seconds after it is sent (addresses at quiet.example never do). */
function answerLater(sent: DemoMessage) {
  const to = parseAddressList(decodeWords(header(sent, 'To'))).find(
    (contact) => contact.email.toLowerCase() !== DEMO_ME.email && !/@quiet\.example$|unsubscribe|no-?reply/i.test(contact.email),
  )
  if (!to) return
  const subject = decodeWords(header(sent, 'Subject'))
  setTimeout(
    () => {
      if (!box.messages.includes(sent)) return
      const sentId = header(sent, 'Message-ID')
      arrive(
        makeMessage(
          {
            thread: sent.threadId,
            from: { name: to.name === to.email ? '' : to.name, email: to.email },
            subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
            html: '<div dir="rtl">קיבלתי, תודה! אחזור אליך בהקדם.</div>',
            labels: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'],
            date: Date.now(),
            inReplyTo: sentId,
            references: [header(sent, 'References'), sentId].filter(Boolean).join(' '),
          },
          box.files,
          ++history,
        ),
      )
    },
    demoFast ? 1200 : 9000,
  )
}

function deliver(message: DemoMessage) {
  message.labelIds = [...message.labelIds.filter((label) => label !== 'DRAFT'), 'SENT']
  message.internalDate = Date.now()
  touch(message)
  const everyone = `${header(message, 'To')} ${header(message, 'Cc')} ${header(message, 'Bcc')}`.toLowerCase()
  // A letter to yourself also lands in your own inbox.
  if (everyone.includes(DEMO_ME.email)) message.labelIds.push('INBOX', 'UNREAD', 'CATEGORY_PERSONAL')
  answerLater(message)
  return { id: message.id, threadId: message.threadId, labelIds: message.labelIds }
}

// ---------- Gmail ----------

async function readBody(init: RequestInit): Promise<{ data: any; raw?: string }> {
  const { body } = init
  if (typeof body === 'string') return { data: JSON.parse(body) }
  if (body instanceof Blob) {
    // An upload: a small JSON part, then the raw email (see `upload` in src/lib/gmail.ts).
    const text = await body.text()
    const type = (init.headers as Record<string, string> | undefined)?.['Content-Type'] ?? ''
    const boundary = /boundary=([^;]+)/.exec(type)?.[1] ?? ''
    const pieces = text.split(`--${boundary}`)
    const meta = pieces[1]?.slice(pieces[1].indexOf('\r\n\r\n') + 4).trim() ?? '{}'
    const letter = pieces[2] ?? ''
    return { data: JSON.parse(meta), raw: letter.slice(letter.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '') }
  }
  return { data: {} }
}

const fromBase64Url = (data: string) => atob(data.replace(/-/g, '+').replace(/_/g, '/'))

export async function demoFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  await wait()
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (init.method ?? 'GET').toUpperCase()
  const path = url.pathname.startsWith(UPLOAD_PATH) ? url.pathname.slice(UPLOAD_PATH.length) : url.pathname.slice(API_PATH.length)
  const params = url.searchParams
  const { data, raw: uploaded } = method === 'GET' ? { data: {}, raw: undefined } : await readBody(init)
  const rawOf = (message: { raw?: string } | undefined) => uploaded ?? (message?.raw ? fromBase64Url(message.raw) : '')
  let match: RegExpExecArray | null

  if (path === '/profile') return json({ emailAddress: DEMO_ME.email, historyId: String(history) })

  // Conversations
  if (path === '/threads' && method === 'GET') {
    const ids = [...new Set(found(params).map((message) => message.threadId))]
    const newest = new Map(ids.map((id) => [id, inThread(id).at(-1)!.internalDate]))
    ids.sort((a, b) => newest.get(b)! - newest.get(a)!)
    const { items, next } = page(ids, params)
    return json({
      threads: items.map((id) => {
        const list = inThread(id)
        return { id, snippet: list.at(-1)!.snippet, historyId: threadHistory(list) }
      }),
      nextPageToken: next,
      resultSizeEstimate: ids.length,
    })
  }
  if ((match = /^\/threads\/([^/]+)$/.exec(path)) && method === 'GET') {
    const list = inThread(match[1]!)
    if (!list.length) return missing()
    const format = params.get('format') ?? 'full'
    return json({ id: match[1], historyId: threadHistory(list), messages: list.map((message) => shape(message, format, params.getAll('metadataHeaders'))) })
  }
  if ((match = /^\/threads\/([^/]+)\/(modify|trash|untrash)$/.exec(path)) && method === 'POST') {
    const list = inThread(match[1]!)
    if (!list.length) return missing()
    const problem =
      match[2] === 'modify'
        ? relabel(list, data.addLabelIds, data.removeLabelIds)
        : match[2] === 'trash'
          ? relabel(list, ['TRASH'], ['INBOX'])
          : relabel(list, [], ['TRASH'])
    return problem ?? json({ id: match[1], historyId: threadHistory(list) })
  }

  // Labels
  if (path === '/labels' && method === 'GET') return json({ labels: box.labels })
  if (path === '/labels' && method === 'POST') {
    const name = String(data.name ?? '').trim()
    if (!name) return refused('Invalid label name')
    if (box.labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) return refused('Label name exists or conflicts', 409)
    const label: DemoLabel = { id: `Label_${nextLabel++}`, name, type: 'user', ...(data.color ? { color: data.color } : {}) }
    box.labels.push(label)
    return json(label)
  }
  if ((match = /^\/labels\/([^/]+)$/.exec(path))) {
    const label = box.labels.find((item) => item.id === decodeURIComponent(match![1]!))
    if (!label) return missing()
    if (method === 'GET') return json(labelCounts(label))
    if (label.type !== 'user') return refused('Invalid delete request')
    if (method === 'PATCH' || method === 'PUT') {
      const name = data.name === undefined ? label.name : String(data.name).trim()
      if (!name) return refused('Invalid label name')
      if (box.labels.some((other) => other !== label && other.name.toLowerCase() === name.toLowerCase())) return refused('Label name exists or conflicts', 409)
      label.name = name
      if ('color' in data) {
        if (data.color) label.color = data.color
        else delete label.color
      }
      return json(label)
    }
    if (method === 'DELETE') {
      box.labels.splice(box.labels.indexOf(label), 1)
      for (const message of box.messages) {
        if (!message.labelIds.includes(label.id)) continue
        message.labelIds = message.labelIds.filter((id) => id !== label.id)
        touch(message)
      }
      server.rules = server.rules.filter((rule) => rule.label_id !== label.id)
      return json()
    }
  }

  // Messages
  if (path === '/messages' && method === 'GET') {
    const list = found(params).sort((a, b) => b.internalDate - a.internalDate)
    const { items, next } = page(list, params)
    return json({ messages: items.map((message) => ({ id: message.id, threadId: message.threadId })), nextPageToken: next, resultSizeEstimate: list.length })
  }
  if (path === '/messages/send' && method === 'POST') {
    const message = fromRaw(rawOf(data), data.threadId, [])
    box.messages.push(message)
    return json(deliver(message))
  }
  if (path === '/messages/batchModify' && method === 'POST') {
    const ids: string[] = data.ids ?? []
    return relabel(box.messages.filter((message) => ids.includes(message.id)), data.addLabelIds, data.removeLabelIds) ?? json()
  }
  if ((match = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path))) {
    const file = box.files.get(match[2]!)
    return file === undefined ? missing() : json({ size: Math.floor((file.length * 3) / 4), data: file })
  }
  if ((match = /^\/messages\/([^/]+)\/modify$/.exec(path)) && method === 'POST') {
    const message = box.messages.find((item) => item.id === match![1])
    if (!message) return missing()
    return relabel([message], data.addLabelIds, data.removeLabelIds) ?? json(shape(message, 'minimal', []))
  }
  if ((match = /^\/messages\/([^/]+)$/.exec(path)) && method === 'GET') {
    const message = box.messages.find((item) => item.id === match![1])
    return message ? json(shape(message, params.get('format') ?? 'full', params.getAll('metadataHeaders'))) : missing()
  }

  // Drafts
  if (path === '/drafts' && method === 'GET') {
    const { items, next } = page([...drafts], params)
    return json({
      drafts: items.map(([id, messageId]) => ({ id, message: { id: messageId, threadId: box.messages.find((message) => message.id === messageId)?.threadId } })),
      nextPageToken: next,
    })
  }
  if (path === '/drafts' && method === 'POST') {
    const message = fromRaw(rawOf(data.message), data.message?.threadId, ['DRAFT'])
    box.messages.push(message)
    const id = `r${nextDraft++}`
    drafts.set(id, message.id)
    return json({ id, message: shape(message, 'minimal', []) })
  }
  if (path === '/drafts/send' && method === 'POST') {
    const message = box.messages.find((item) => item.id === drafts.get(data.id))
    if (!message) return missing()
    drafts.delete(data.id)
    return json(deliver(message))
  }
  if ((match = /^\/drafts\/([^/]+)$/.exec(path))) {
    const id = match[1]!
    const index = box.messages.findIndex((item) => item.id === drafts.get(id))
    if (index < 0) return missing()
    const old = box.messages[index]!
    if (method === 'GET') return json({ id, message: shape(old, params.get('format') ?? 'full', []) })
    if (method === 'DELETE') {
      box.messages.splice(index, 1)
      drafts.delete(id)
      return json()
    }
    if (method === 'PUT') {
      // Like Gmail, a saved change makes the draft a new message.
      const message = fromRaw(rawOf(data.message), data.message?.threadId ?? old.threadId, ['DRAFT'])
      box.messages[index] = message
      drafts.set(id, message.id)
      return json({ id, message: shape(message, 'minimal', []) })
    }
  }

  return refused(`The demo mailbox does not know ${method} ${path}`, 501)
}

// ---------- Doar's server ----------

type ScheduledRow = {
  id: string
  draft_id: string
  thread_id: string | null
  message_id: string | null
  send_at: string
  status: 'pending' | 'sending' | 'failed'
  error: string | null
  followup_days: number | null
}

type ReminderRow = {
  id: string
  kind: 'hold' | 'reply'
  thread_id: string
  after_message_id: string | null
  days: number | null
  due_at: string
  status: 'waiting' | 'working' | 'returned' | 'answered' | 'cancelled'
  done_at: string | null
}

type MarkRow = { id: string; match: string; mark: 'express' | 'refused' }

const server = {
  scope: 'important',
  scheduled: [] as ScheduledRow[],
  rules: [] as Rule[],
  reminders: [] as ReminderRow[],
  marks: [] as MarkRow[],
  notes: new Map<string, { text: string; updated_at: string }>(),
  prefs: null as Record<string, unknown> | null,
  hours: null as Hours | null,
  /** Fault reports the app sent, kept where the screen checks can read them. */
  reports: [] as Record<string, unknown>[],
  timers: new Map<string, ReturnType<typeof setTimeout>>(),
}
let nextRow = 1
;(window as Window & { __doarDemo?: unknown }).__doarDemo = Object.assign(server, {
  /** For the screen checks: make this conversation's waiting reminder come due right now. */
  due: (threadId: string) => {
    const row = server.reminders.find((item) => item.thread_id === threadId && item.status === 'waiting')
    if (row) remind(row)
    return !!row
  },
})

const stamp = () => new Date().toISOString()
const idText = (value: unknown): string | null => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null)

function validTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  if (Number.isNaN(time) || time < Date.now() + 30_000 || time > Date.now() + 366 * DAY) return null
  return new Date(time).toISOString()
}

/** Run something at a time, the way the real server's once-a-minute timer would get to it. */
function at(id: string, when: string, run: () => void) {
  clearTimeout(server.timers.get(id))
  const delay = Date.parse(when) - Date.now()
  if (delay > 2_000_000_000) return
  server.timers.set(id, setTimeout(run, Math.max(0, delay)))
}

/** When a waiting letter's time comes, it goes out. */
function arm(row: ScheduledRow) {
  at(row.id, row.send_at, () => {
    server.scheduled = server.scheduled.filter((item) => item !== row)
    const message = box.messages.find((item) => item.id === drafts.get(row.draft_id))
    if (!message) return
    drafts.delete(row.draft_id)
    const sent = deliver(message)
    const days = validDays(row.followup_days)
    if (days) saveReminder({ kind: 'reply', thread_id: sent.threadId, after_message_id: sent.id, days, due_at: new Date(Date.now() + days * DAY).toISOString() })
    window.dispatchEvent(new Event('doar-demo-mail'))
  })
}

function saveReminder(values: Pick<ReminderRow, 'kind' | 'thread_id' | 'due_at'> & Partial<ReminderRow>): ReminderRow {
  for (const old of server.reminders) {
    if (old.thread_id === values.thread_id && old.kind === values.kind && old.status === 'waiting') {
      old.status = 'cancelled'
      clearTimeout(server.timers.get(old.id))
    }
  }
  const row: ReminderRow = { id: `rem${nextRow++}`, after_message_id: null, days: null, status: 'waiting', done_at: null, ...values }
  server.reminders.push(row)
  at(row.id, row.due_at, () => remind(row))
  return row
}

/** A reminder's time has come (see `remind` in the real server). */
function remind(row: ReminderRow) {
  if (row.status !== 'waiting') return
  const finish = (status: ReminderRow['status']) => {
    row.status = status
    row.done_at = stamp()
  }
  const list = inThread(row.thread_id).filter((message) => !message.labelIds.includes('DRAFT'))
  const last = list.at(-1)
  if (!last || list.every((message) => message.labelIds.includes('TRASH'))) return finish('cancelled')
  if (row.kind === 'reply') {
    const state = replyState({ messages: list.map((message) => ({ id: message.id, labelIds: message.labelIds, internalDate: String(message.internalDate) })) }, row.after_message_id ?? '')
    if (state !== 'waiting') return finish(state === 'answered' ? 'answered' : 'cancelled')
  } else if (last.labelIds.includes('INBOX') && !last.labelIds.includes('SENT')) {
    return finish('cancelled')
  }
  relabel(list, ['INBOX'])
  relabel([last], ['UNREAD'])
  finish('returned')
  window.dispatchEvent(new Event('doar-demo-mail'))
}

/** New mail in a conversation settles what was waiting on it, and mail from a refused sender goes to the bin. */
function onArrival(message: DemoMessage): void {
  const from = senderAddress(header(message, 'From'))
  if (server.marks.some((mark) => mark.mark === 'refused' && matches(mark.match, from))) {
    message.labelIds = [...message.labelIds.filter((label) => label !== 'INBOX'), 'TRASH']
    return
  }
  for (const row of server.reminders) {
    if (row.thread_id !== message.threadId || row.status !== 'waiting') continue
    row.status = row.kind === 'hold' ? 'cancelled' : 'answered'
    row.done_at = stamp()
    clearTimeout(server.timers.get(row.id))
  }
}

type Answer = { data: any } | { error: string }
const ok = (data: unknown = { ok: true }): Answer => ({ data })
const no = (error: string): Answer => ({ error })

/** The demo's answer to what the app asks Doar's server (see supabase/functions/postman/index.ts). */
export async function demoPostman(body: Record<string, any>): Promise<Answer> {
  await wait()
  switch (body.action) {
    case 'status': {
      const recently = Date.now() - 2 * DAY
      return ok({
        scope: server.scope,
        endpoints: ['demo-device'],
        scheduled: server.scheduled,
        rules: server.rules,
        devices: [{ device: 'מכשיר להדגמה', last_ok_at: stamp() }],
        looked_at: stamp(),
        hours: server.hours,
        prefs: server.prefs,
        reminders: server.reminders.filter((row) => row.status === 'waiting' || (row.status === 'returned' && Date.parse(row.done_at ?? '') > recently)),
        marks: server.marks,
        notes: [...server.notes].map(([thread_id, note]) => ({ thread_id, ...note })),
        last_report: null,
      })
    }
    case 'prefs-set': {
      const data: Record<string, unknown> = { ...server.prefs, ...body.patch }
      for (const key of Object.keys(data)) if (data[key] === null) delete data[key]
      server.prefs = data
      return ok({ prefs: data })
    }
    case 'report':
      server.reports.push(body)
      console.info('[demo] fault report', body.place, body.message)
      return ok()
    case 'hours-set': {
      const hours = body.hours === null ? null : validHours(body.hours)
      if (body.hours !== null && !hours) return no('bad_hours')
      server.hours = hours
      return ok({ hours })
    }
    case 'hold-create': {
      const due = validDue(body.due_at)
      const threadId = idText(body.thread_id)
      if (!due || !threadId) return no('bad_time')
      return ok({ reminder: saveReminder({ kind: 'hold', thread_id: threadId, due_at: due }) })
    }
    case 'reply-create': {
      const days = validDays(body.days)
      const threadId = idText(body.thread_id)
      const after = idText(body.after_message_id)
      if (!days || !threadId || !after) return no('bad_time')
      return ok({ reminder: saveReminder({ kind: 'reply', thread_id: threadId, after_message_id: after, days, due_at: new Date(Date.now() + days * DAY).toISOString() }) })
    }
    case 'reminder-update': {
      const due = validDue(body.due_at)
      const row = server.reminders.find((item) => item.id === body.id && item.status === 'waiting')
      if (!due) return no('bad_time')
      if (!row) return no('too_late')
      row.due_at = due
      at(row.id, due, () => remind(row))
      return ok({ reminder: row })
    }
    case 'reminder-cancel':
      clearTimeout(server.timers.get(body.id))
      server.reminders = server.reminders.filter((row) => row.id !== body.id)
      return ok()
    case 'mark-set': {
      const match = normalizeMatch(String(body.match ?? ''))
      if (!match) return no('bad_match')
      if (body.mark !== 'express' && body.mark !== 'refused') return no('bad_mark')
      const existing = server.marks.find((mark) => mark.match === match && mark.mark === body.mark)
      if (body.on === false) {
        server.marks = server.marks.filter((mark) => mark !== existing)
        return ok()
      }
      if (existing) return ok({ mark: existing })
      const mark: MarkRow = { id: `mark${nextRow++}`, match, mark: body.mark }
      server.marks.push(mark)
      return ok({ mark })
    }
    case 'note-set': {
      const threadId = idText(body.thread_id)
      if (!threadId) return no('bad_note')
      const text = String(body.text ?? '').trim().slice(0, 4000)
      if (text) server.notes.set(threadId, { text, updated_at: stamp() })
      else server.notes.delete(threadId)
      return ok()
    }
    case 'unsubscribe': {
      const message = box.messages.find((item) => item.id === body.message_id)
      if (!message) return no('message_missing')
      const list = header(message, 'List-Unsubscribe')
      const url = /<(https:\/\/[^>\s]+)>/i.exec(list)?.[1] ?? null
      const mailto = /<mailto:([^>\s]+)>/i.exec(list)?.[1] ?? null
      // A list that takes "one click" is taken off right here; the demo has no real list to call.
      if (url && /one-click/i.test(header(message, 'List-Unsubscribe-Post'))) return ok({ done: 'posted', mailto, url })
      return ok({ done: null, mailto, url })
    }
    case 'push-scope':
      server.scope = String(body.scope)
      return ok()
    case 'push-test':
      // No real device stands behind the demo.
      return ok({ results: [] })
    case 'schedule-create': {
      const sendAt = validTime(body.send_at)
      if (!sendAt) return no('bad_time')
      const message = box.messages.find((item) => item.id === drafts.get(body.draft_id))
      if (!message) return no('draft_missing')
      server.scheduled = server.scheduled.filter((row) => row.draft_id !== body.draft_id)
      const row: ScheduledRow = {
        id: `s${nextRow++}`,
        draft_id: body.draft_id,
        thread_id: message.threadId,
        message_id: message.id,
        send_at: sendAt,
        status: 'pending',
        error: null,
        followup_days: validDays(body.followup_days),
      }
      server.scheduled.push(row)
      arm(row)
      return ok({ scheduled: row })
    }
    case 'schedule-update': {
      const sendAt = validTime(body.send_at)
      const row = server.scheduled.find((item) => item.id === body.id)
      if (!sendAt) return no('bad_time')
      if (!row) return no('too_late')
      row.send_at = sendAt
      arm(row)
      return ok({ scheduled: row })
    }
    case 'schedule-cancel':
      clearTimeout(server.timers.get(body.id))
      server.scheduled = server.scheduled.filter((item) => item.id !== body.id)
      return ok()
    case 'rule-create': {
      const match = normalizeMatch(String(body.match ?? ''))
      if (!match) return no('bad_match')
      if (!box.labels.some((label) => label.id === body.label_id && label.type === 'user')) return no('label_missing')
      let rule = server.rules.find((item) => item.match === match && item.label_id === body.label_id)
      if (!rule) {
        rule = { id: `rule${nextRow++}`, match, label_id: body.label_id }
        server.rules.push(rule)
      }
      if (body.existing !== true) return ok({ rule })
      const hits = box.messages.filter((message) => !message.labelIds.includes('DRAFT') && labelsFor([rule], header(message, 'From')).length > 0)
      relabel(hits, [rule.label_id])
      return ok({ rule, labeled: hits.length, thread_ids: [...new Set(hits.map((message) => message.threadId))] })
    }
    case 'rule-delete':
      server.rules = server.rules.filter((rule) => rule.id !== body.id)
      return ok()
    default:
      // Notifications need a real device and a real server.
      return no('unsupported')
  }
}
