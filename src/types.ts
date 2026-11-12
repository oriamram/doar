export type Contact = {
  name: string
  email: string
}

/** Gmail's automatic sorting of incoming mail. */
export type Category = 'primary' | 'promotions' | 'social' | 'updates' | 'forums'

/** One conversation as shown in a list. */
export type Thread = {
  id: string
  /** Changes whenever anything in the conversation changes; used to skip re-fetching. */
  historyId: string
  /** Who to show: the latest sender who isn't you, or the recipient of mail you wrote. */
  from: Contact
  /** True when every message is yours, so `from` is who you wrote to. */
  outgoing: boolean
  subject: string
  snippet: string
  /** ISO 8601 timestamp of the latest message. */
  date: string
  unread: boolean
  starred: boolean
  /** Messages in the conversation, not counting unsent drafts. */
  messageCount: number
  /** Every Gmail label on any message of the conversation. */
  labelIds: string[]
  hasAttachment: boolean
  hasDraft: boolean
  category: Category
}

export type Attachment = {
  /** Unique within the app: message id plus position. */
  key: string
  messageId: string
  /** Gmail's handle for fetching the bytes; small parts carry `data` instead. */
  attachmentId?: string
  /** base64url bytes, when Gmail sent them inline with the message. */
  data?: string
  filename: string
  mimeType: string
  size: number
  /** For images placed inside the email body ("cid:" references). */
  contentId?: string
}

/** One email inside a conversation. */
export type Message = {
  id: string
  threadId: string
  from: Contact
  to: Contact[]
  cc: Contact[]
  bcc: Contact[]
  replyTo: Contact[]
  subject: string
  /** ISO 8601 timestamp. */
  date: string
  snippet: string
  /** Email bodies are HTML; they are rendered in a sandboxed iframe (see EmailBody). */
  bodyHtml: string
  /** The same body as plain text, for quoting in replies. */
  bodyText: string
  attachments: Attachment[]
  labelIds: string[]
  isDraft: boolean
  /** The Message-ID, In-Reply-To and References headers, for threading replies. */
  messageIdHeader: string
  inReplyTo: string
  references: string
  /** Where a newsletter says you can unsubscribe. */
  unsubscribe?: { url?: string; mailto?: string }
}

export type Label = {
  id: string
  name: string
  type: 'system' | 'user'
  /** The color chosen in Gmail, if any. */
  color?: string
}

/** A file being sent: picked from this device, or carried over from another email. */
export type ComposeAttachment = {
  key: string
  filename: string
  mimeType: string
  size: number
  file?: File
  remote?: { messageId: string; attachmentId?: string; data?: string }
  /** Standard base64 of the bytes, filled in the first time the email is built. */
  base64?: string
}

/** An email being written. */
export type ComposeDraft = {
  mode: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft'
  /** Set once the email has been saved to Gmail's Drafts. */
  draftId?: string
  /** The conversation this email continues. */
  threadId?: string
  inReplyTo?: string
  references?: string
  to: Contact[]
  cc: Contact[]
  bcc: Contact[]
  subject: string
  /** What's in the editor. */
  html: string
  /** The email being answered or forwarded, added below what you write. */
  quote?: { html: string; text: string; include: boolean }
  attachments: ComposeAttachment[]
}
