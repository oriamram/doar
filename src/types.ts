export type Contact = {
  name: string
  email: string
}

/** One conversation as shown in the inbox list. */
export type Thread = {
  id: string
  /** Sender of the latest message. */
  from: Contact
  subject: string
  snippet: string
  /** ISO 8601 timestamp of the latest message. */
  date: string
  unread: boolean
  starred: boolean
  messageCount: number
}

/** One email inside a conversation. */
export type Message = {
  id: string
  from: Contact
  to: string
  /** ISO 8601 timestamp. */
  date: string
  snippet: string
  /** Email bodies are HTML; they are rendered in a sandboxed iframe (see EmailBody). */
  bodyHtml: string
}
