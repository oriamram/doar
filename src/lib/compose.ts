import DOMPurify from 'dompurify'
import type { Attachment, ComposeAttachment, ComposeDraft, Contact, Message } from '../types'
import { sameEmail, uniqueContacts } from './addresses'
import { formatQuoteDate } from './format'
import { escapeHtml, getAttachmentBytes } from './gmail'
import { buildMime, bytesToBase64 } from './mime'
import { getSettings } from './settings'

/** Building the email being written: starting points (new, reply, forward, saved draft) and the final raw email. */

let nextKey = 1
const attachmentKey = () => `a${nextKey++}`

/** Files picked on this device, ready to attach. */
export function filesToAttachments(files: Iterable<File>): ComposeAttachment[] {
  return [...files].map((file) => ({
    key: attachmentKey(),
    filename: file.name || 'קובץ',
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    file,
  }))
}

/** Files of another email, to carry along when forwarding or reopening a draft. */
function carryAttachments(message: Message): ComposeAttachment[] {
  return realAttachments(message).map((file) => ({
    key: attachmentKey(),
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    remote: { messageId: file.messageId, attachmentId: file.attachmentId, data: file.data },
  }))
}

/** Attached files, leaving out pictures that are part of the email's body. */
export function realAttachments(message: Message): Attachment[] {
  return message.attachments.filter((file) => !(file.contentId && message.bodyHtml.includes(`cid:${file.contentId}`)))
}

function signatureHtml(): string {
  const signature = getSettings().signature.trim()
  if (!signature) return ''
  const lines = signature.split('\n').map(escapeHtml).join('<br>')
  return `<div><br></div><div><br></div><div>-- <br>${lines}</div>`
}

export function newDraft(to: Contact[] = []): ComposeDraft {
  return { mode: 'new', to, cc: [], bcc: [], subject: '', html: signatureHtml(), attachments: [] }
}

const withPrefix = (prefix: 'Re' | 'Fwd', already: RegExp, subject: string) =>
  already.test(subject) ? subject : `${prefix}: ${subject}`

/** The body of an email, without its page wrapper or anything that could run. */
function bodyInner(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, title, meta, link, base').forEach((element) => element.remove())
  return doc.body.innerHTML
}

const quoteLines = (text: string) =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

const who = (contact: Contact) =>
  contact.name && contact.name !== contact.email ? `${contact.name} <${contact.email}>` : contact.email

/** An answer to `message`, or a copy of it to pass on. */
export function replyDraft(message: Message, mode: 'reply' | 'replyAll' | 'forward', me: Contact): ComposeDraft {
  const notMe = (contact: Contact) => !sameEmail(contact.email, me.email)
  const mine = !notMe(message.from)
  const sender = message.replyTo.length ? message.replyTo : [message.from]

  let to: Contact[] = []
  let cc: Contact[] = []
  if (mode === 'reply') {
    to = mine ? message.to : sender
  } else if (mode === 'replyAll') {
    to = uniqueContacts(mine ? message.to : [...sender, ...message.to]).filter(notMe)
    cc = uniqueContacts(message.cc).filter((contact) => notMe(contact) && !to.some((t) => sameEmail(t.email, contact.email)))
    if (to.length === 0) to = sender
  }

  const original = bodyInner(message.bodyHtml)
  const date = formatQuoteDate(message.date)
  let quoteHtml: string
  let quoteText: string
  if (mode === 'forward') {
    const lines = [
      '---------- הודעה שהועברה ----------',
      `מאת: ${who(message.from)}`,
      `תאריך: ${date}`,
      `נושא: ${message.subject}`,
      `אל: ${message.to.map(who).join(', ')}`,
    ]
    quoteHtml = `<div class="gmail_quote"><div dir="rtl">${lines.map(escapeHtml).join('<br>')}</div><br>${original}</div>`
    quoteText = `${lines.join('\n')}\n\n${message.bodyText}`
  } else {
    const attribution = `בתאריך ${date}, ${who(message.from)} כתב/ה:`
    quoteHtml =
      `<div class="gmail_quote"><div dir="rtl">${escapeHtml(attribution)}</div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${original}</blockquote></div>`
    quoteText = `${attribution}\n${quoteLines(message.bodyText)}`
  }

  return {
    mode,
    threadId: mode === 'forward' ? undefined : message.threadId,
    inReplyTo: mode === 'forward' ? undefined : message.messageIdHeader || undefined,
    references:
      mode === 'forward' ? undefined : [message.references, message.messageIdHeader].filter(Boolean).join(' ') || undefined,
    to,
    cc,
    bcc: [],
    subject:
      mode === 'forward'
        ? withPrefix('Fwd', /^\s*(fwd?|הועבר)\s*:/i, message.subject)
        : withPrefix('Re', /^\s*(re|תשובה)\s*:/i, message.subject),
    html: signatureHtml(),
    quote: { html: quoteHtml, text: quoteText, include: true },
    attachments: mode === 'forward' ? carryAttachments(message) : [],
  }
}

/** Reopen an email saved in Drafts. */
export function draftFromMessage(message: Message, draftId: string): ComposeDraft {
  // The quoted email stays out of the editor (and out of this page): it's kept
  // as-is and re-attached when the email is saved or sent.
  const doc = new DOMParser().parseFromString(message.bodyHtml, 'text/html')
  const quoted = doc.querySelector('.gmail_quote')
  const quoteHtml = quoted?.outerHTML
  const quoteText = quoted?.textContent ?? ''
  quoted?.remove()
  return {
    mode: 'draft',
    draftId,
    threadId: message.threadId,
    inReplyTo: message.inReplyTo || undefined,
    references: message.references || undefined,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    html: sanitizeForEditor(doc.body.innerHTML),
    quote: quoteHtml ? { html: quoteHtml, text: quoteLines(quoteText), include: true } : undefined,
    attachments: carryAttachments(message),
  }
}

/** Only simple formatting may enter the editor; nothing that loads or runs. */
export function sanitizeForEditor(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['a', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'div', 'p', 'span', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code'],
    ALLOWED_ATTR: ['href', 'dir'],
  })
}

/** Hebrew or Arabic first → right-to-left; Latin first → left-to-right. */
function direction(text: string): 'rtl' | 'ltr' {
  const strong = text.match(/[֐-ࣿ]|[A-Za-z]/)?.[0]
  return strong && /[A-Za-z]/.test(strong) ? 'ltr' : 'rtl'
}

/** Turn web addresses typed as plain text into links. */
function linkify(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.parentElement?.closest('a') && /https?:\/\//.test(node.data)) texts.push(node)
  }
  for (const node of texts) {
    const fragment = doc.createDocumentFragment()
    for (const piece of node.data.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/)) {
      if (/^https?:\/\//.test(piece)) {
        const link = doc.createElement('a')
        link.href = piece
        link.textContent = piece
        fragment.append(link)
      } else if (piece) {
        fragment.append(piece)
      }
    }
    node.replaceWith(fragment)
  }
  return doc.body.innerHTML
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error(`לא הצלחנו לקרוא את הקובץ ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

/** The file's bytes as base64, read once and kept on the attachment. */
async function attachmentBase64(attachment: ComposeAttachment): Promise<string> {
  if (attachment.base64 === undefined) {
    if (attachment.file) attachment.base64 = await readFile(attachment.file)
    else if (attachment.remote) attachment.base64 = bytesToBase64(await getAttachmentBytes(attachment.remote))
    else attachment.base64 = ''
  }
  return attachment.base64
}

/** The complete raw email for a draft, ready to save or send. `text` is the editor's plain text. */
export async function buildRaw(draft: ComposeDraft, text: string, me: Contact): Promise<string> {
  const attachments = await Promise.all(
    draft.attachments.map(async (attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      base64: await attachmentBase64(attachment),
    })),
  )
  const quote = draft.quote?.include ? draft.quote : undefined
  return buildMime({
    from: me,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    html: `<div dir="${direction(text || draft.subject)}">${linkify(draft.html)}</div>${quote ? `<br>${quote.html}` : ''}`,
    text: quote ? `${text}\n\n${quote.text}` : text,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    attachments,
  })
}

/** Whether there is anything worth saving. */
export function isBlank(draft: ComposeDraft, text: string): boolean {
  const signature = getSettings().signature.trim()
  const body = text.replace(/^--\s*$/m, '').replace(signature, '').trim()
  return !draft.to.length && !draft.cc.length && !draft.bcc.length && !draft.subject.trim() && !body && !draft.attachments.length
}
