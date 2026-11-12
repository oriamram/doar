import type { Contact } from '../types'

/**
 * Builds the raw text of an email (RFC 5322 / MIME), which is what Gmail's API
 * takes for sending and for drafts. Everything is kept ASCII: Hebrew in headers
 * goes into encoded words, and bodies and files are base64.
 */

export type OutgoingAttachment = { filename: string; mimeType: string; base64: string }

export type Outgoing = {
  from: Contact
  to: Contact[]
  cc: Contact[]
  bcc: Contact[]
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references?: string
  attachments: OutgoingAttachment[]
}

const CRLF = '\r\n'
const encoder = new TextEncoder()

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64UrlToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const utf8ToBase64 = (text: string) => bytesToBase64(encoder.encode(text))

/** Break base64 into the 76-character lines MIME asks for. */
const wrap76 = (base64: string) => base64.replace(/.{76}(?=.)/g, `$&${CRLF}`)

const isAscii = (text: string) => /^[\x20-\x7e]*$/.test(text)

/** Header values must stay on one line: no smuggling extra headers in a subject. */
const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim()

/** Hebrew (or any non-ASCII) header text as RFC 2047 encoded words, 75 characters each at most. */
function encodeWords(text: string): string {
  if (isAscii(text)) return text
  const words: string[] = []
  let chunk = ''
  let size = 0
  for (const char of text) {
    const bytes = encoder.encode(char).length
    if (size + bytes > 45) {
      words.push(chunk)
      chunk = ''
      size = 0
    }
    chunk += char
    size += bytes
  }
  if (chunk) words.push(chunk)
  return words.map((word) => `=?UTF-8?B?${utf8ToBase64(word)}?=`).join(`${CRLF} `)
}

function formatAddress(contact: Contact): string {
  const email = oneLine(contact.email)
  const name = oneLine(contact.name)
  if (!name || name === email) return email
  const display = isAscii(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : encodeWords(name)
  return `${display} <${email}>`
}

const addressLine = (label: string, contacts: Contact[]) =>
  contacts.length ? `${label}: ${contacts.map(formatAddress).join(`,${CRLF} `)}` : ''

/** Both spellings of a file name, so every mail program shows Hebrew names correctly. */
function fileHeaders(attachment: OutgoingAttachment): string[] {
  const name = oneLine(attachment.filename).replace(/["\\]/g, '_') || 'file'
  const type = attachment.mimeType || 'application/octet-stream'
  if (isAscii(name)) {
    return [`Content-Type: ${type}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`]
  }
  return [
    `Content-Type: ${type}; name="${encodeWords(name)}"`,
    `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
  ]
}

const boundary = (tag: string) => `=_doar_${tag}_${crypto.randomUUID().replace(/-/g, '')}`

export function buildMime(message: Outgoing): string {
  const headers = [
    `From: ${formatAddress(message.from)}`,
    addressLine('To', message.to),
    addressLine('Cc', message.cc),
    addressLine('Bcc', message.bcc),
    `Subject: ${encodeWords(oneLine(message.subject))}`,
    message.inReplyTo ? `In-Reply-To: ${oneLine(message.inReplyTo)}` : '',
    message.references ? `References: ${oneLine(message.references).split(/\s+/).join(`${CRLF} `)}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean)

  // The same letter twice: plain text for simple mail programs, HTML for the rest.
  const alt = boundary('alt')
  const body = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8ToBase64(message.text)),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8ToBase64(message.html)),
    `--${alt}--`,
  ].join(CRLF)

  if (message.attachments.length === 0) return [...headers, body].join(CRLF)

  const mixed = boundary('mixed')
  const files = message.attachments.map((attachment) =>
    [`--${mixed}`, ...fileHeaders(attachment), 'Content-Transfer-Encoding: base64', '', wrap76(attachment.base64)].join(CRLF),
  )
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    body,
    ...files,
    `--${mixed}--`,
  ].join(CRLF)
}
