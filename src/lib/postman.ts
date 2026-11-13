import type { Hours } from '../../supabase/functions/postman/hours.ts'
import { isDemo } from './demo'
import { supabase } from './supabase'

/**
 * The app's side of the `postman` Edge Function: the part of Doar that works while
 * the app is closed (scheduled sending, notifications, held and registered mail,
 * sender marks), and what it keeps for the app (shared preferences, notes, fault reports).
 */

/** Which new mail to be notified about. */
export type NotifyScope = 'all' | 'important' | 'primary'

/** A letter waiting in Drafts for its time. */
export type ScheduledSend = {
  id: string
  draftId: string
  threadId: string | null
  messageId: string | null
  /** When it goes out (ISO time). */
  sendAt: string
  status: 'pending' | 'sending' | 'failed'
  /** Why it wasn't sent, when it failed. */
  error: string | null
  /** Registered: once it goes out, wait this many days for an answer. */
  followupDays: number | null
}

/** Mail from `match` (a full address, or a whole site written "@site") gets the label by itself. */
export type LabelRule = { id: string; match: string; labelId: string }

/**
 * Held mail ("hold": bring this conversation back at `dueAt`) and registered mail
 * ("reply": say so if nobody answered the sent letter by `dueAt`).
 */
export type Reminder = {
  id: string
  kind: 'hold' | 'reply'
  threadId: string
  afterMessageId: string | null
  days: number | null
  dueAt: string
  /** "returned": the server brought it back to the inbox in the last two days. */
  status: 'waiting' | 'working' | 'returned'
  doneAt: string | null
}

/** What you decided about a sender: always notify at once, or never wanting their mail. */
export type SenderMark = { id: string; match: string; mark: 'express' | 'refused' }

/** A note you wrote on a letter. */
export type Note = { threadId: string; text: string; updatedAt: string }

export type Device = { device: string; lastOkAt: string | null }

export type { Hours }

export type ServerStatus = {
  scope: NotifyScope
  endpoints: string[]
  scheduled: ScheduledSend[]
  rules: LabelRule[]
  /** Your devices that receive notifications, and when each last got one. */
  devices: Device[]
  /** When the server last looked for new mail (ISO time), if it ever did. */
  lookedAt: string | null
  /** Opening hours for notifications; null when they may always arrive. */
  hours: Hours | null
  /** Preferences shared by your devices; null until one of them saved any. */
  prefs: Record<string, unknown> | null
  reminders: Reminder[]
  marks: SenderMark[]
  notes: Note[]
  lastReport: { at: string; place: string; message: string } | null
}

type Row = {
  id: string
  draft_id: string
  thread_id: string | null
  message_id: string | null
  send_at: string
  status: ScheduledSend['status']
  error: string | null
  followup_days?: number | null
}

const fromRow = (row: Row): ScheduledSend => ({
  id: row.id,
  draftId: row.draft_id,
  threadId: row.thread_id,
  messageId: row.message_id,
  sendAt: row.send_at,
  status: row.status,
  error: row.error,
  followupDays: row.followup_days ?? null,
})

type RuleRow = { id: string; match: string; label_id: string }

const fromRule = (row: RuleRow): LabelRule => ({ id: row.id, match: row.match, labelId: row.label_id })

type ReminderRow = {
  id: string
  kind: Reminder['kind']
  thread_id: string
  after_message_id: string | null
  days: number | null
  due_at: string
  status: Reminder['status']
  done_at: string | null
}

const fromReminder = (row: ReminderRow): Reminder => ({
  id: row.id,
  kind: row.kind,
  threadId: row.thread_id,
  afterMessageId: row.after_message_id,
  days: row.days,
  dueAt: row.due_at,
  status: row.status,
  doneAt: row.done_at,
})

/** The server said no; `code` says why ("too_late", "draft_missing", "reauth"…). */
export class PostmanError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (isDemo) {
    const answer = await (await import('../demo/server')).demoPostman(body)
    if ('error' in answer) throw new PostmanError(answer.error)
    return answer.data as T
  }
  const { data, error } = await supabase.functions.invoke('postman', { body })
  if (!error) return data as T
  let code = ''
  try {
    code = ((await (error as { context?: Response }).context?.json()) as { error?: string } | undefined)?.error ?? ''
  } catch {
    // No readable answer (offline, or the server is down).
  }
  throw new PostmanError(code || 'unreachable')
}

type StatusAnswer = {
  scope: NotifyScope
  endpoints: string[]
  scheduled: Row[]
  rules?: RuleRow[]
  devices?: { device: string; last_ok_at: string | null }[]
  looked_at?: string | null
  hours?: Hours | null
  prefs?: Record<string, unknown> | null
  reminders?: ReminderRow[]
  marks?: SenderMark[]
  notes?: { thread_id: string; text: string; updated_at: string }[]
  last_report?: { at: string; place: string; message: string } | null
}

export async function serverStatus(): Promise<ServerStatus> {
  const status = await call<StatusAnswer>({ action: 'status' })
  return {
    scope: status.scope,
    endpoints: status.endpoints,
    scheduled: status.scheduled.map(fromRow),
    rules: (status.rules ?? []).map(fromRule),
    devices: (status.devices ?? []).map((row) => ({ device: row.device, lastOkAt: row.last_ok_at })),
    lookedAt: status.looked_at ?? null,
    hours: status.hours ?? null,
    prefs: status.prefs ?? null,
    reminders: (status.reminders ?? []).map(fromReminder),
    marks: status.marks ?? [],
    notes: (status.notes ?? []).map((row) => ({ threadId: row.thread_id, text: row.text, updatedAt: row.updated_at })),
    lastReport: status.last_report ?? null,
  }
}

export const pushKey = () => call<{ publicKey: string }>({ action: 'push-key' }).then((answer) => answer.publicKey)

export const pushSubscribe = (subscription: { endpoint: string; p256dh: string; auth: string }, device: string) =>
  call<{ ok: true }>({ action: 'push-subscribe', ...subscription, device })

export const pushUnsubscribe = (endpoint: string) => call<{ ok: true }>({ action: 'push-unsubscribe', endpoint })

export const pushTest = () =>
  call<{ results: { device: string; status: number; detail?: string }[] }>({ action: 'push-test' }).then((answer) => answer.results)

export const pushScope = (scope: NotifyScope) => call<{ ok: true }>({ action: 'push-scope', scope })

/** `followupDays` registers the letter: once it goes out, the server waits that long for an answer. */
export const scheduleCreate = (draftId: string, sendAt: Date, followupDays: number | null = null) =>
  call<{ scheduled: Row }>({ action: 'schedule-create', draft_id: draftId, send_at: sendAt.toISOString(), followup_days: followupDays }).then((answer) =>
    fromRow(answer.scheduled),
  )

export const scheduleUpdate = (id: string, sendAt: Date) =>
  call<{ scheduled: Row }>({ action: 'schedule-update', id, send_at: sendAt.toISOString() }).then((answer) => fromRow(answer.scheduled))

export const scheduleCancel = (id: string) => call<{ ok: true }>({ action: 'schedule-cancel', id })

export type RuleSaved = {
  rule: LabelRule
  /** How many letters that had already arrived got the label; null if that part failed. */
  labeled: number | null
  /** The conversations those letters belong to. */
  threadIds: string[]
}

/**
 * `from` is whatever the person typed; the server tidies it into an address or a site, or
 * refuses it. With `existing`, the server also labels that sender's mail that is already here.
 */
export const ruleCreate = (from: string, labelId: string, existing: boolean): Promise<RuleSaved> =>
  call<{ rule: RuleRow; labeled?: number | null; thread_ids?: string[] }>({
    action: 'rule-create',
    match: from,
    label_id: labelId,
    existing,
  }).then((answer) => ({
    rule: fromRule(answer.rule),
    labeled: existing ? (answer.labeled ?? null) : 0,
    threadIds: answer.thread_ids ?? [],
  }))

export const ruleDelete = (id: string) => call<{ ok: true }>({ action: 'rule-delete', id })

/** Hold a conversation: the server brings it back to the inbox at `due`. */
export const holdCreate = (threadId: string, due: Date) =>
  call<{ reminder: ReminderRow }>({ action: 'hold-create', thread_id: threadId, due_at: due.toISOString() }).then((answer) => fromReminder(answer.reminder))

/** Register a sent letter: the server says so if nobody answers it within `days`. */
export const replyCreate = (threadId: string, afterMessageId: string, days: number) =>
  call<{ reminder: ReminderRow }>({ action: 'reply-create', thread_id: threadId, after_message_id: afterMessageId, days }).then((answer) =>
    fromReminder(answer.reminder),
  )

export const reminderUpdate = (id: string, due: Date) =>
  call<{ reminder: ReminderRow }>({ action: 'reminder-update', id, due_at: due.toISOString() }).then((answer) => fromReminder(answer.reminder))

export const reminderCancel = (id: string) => call<{ ok: true }>({ action: 'reminder-cancel', id })

/** Mark a sender (an address, or a whole site), or take the mark off. Resolves to the mark when one was set. */
export const markSet = (match: string, mark: SenderMark['mark'], on: boolean) =>
  call<{ mark?: SenderMark }>({ action: 'mark-set', match, mark, on }).then((answer) => answer.mark ?? null)

export const hoursSet = (hours: Hours | null) => call<{ hours: Hours | null }>({ action: 'hours-set', hours }).then((answer) => answer.hours)

/** Save a note on a conversation; empty text removes it. */
export const noteSet = (threadId: string, text: string) => call<{ ok: true }>({ action: 'note-set', thread_id: threadId, text })

/**
 * Ask a mailing list to stop writing. `done` is "posted" when the server did it with the
 * list's one-click address; otherwise the list's email address or page comes back for the app to use.
 */
export const unsubscribe = (messageId: string) =>
  call<{ done: 'posted' | null; mailto: string | null; url: string | null }>({ action: 'unsubscribe', message_id: messageId })

/** Save preferences for all of your devices. A key set to null is removed. */
export const prefsSet = (patch: Record<string, unknown>) =>
  call<{ prefs: Record<string, unknown> }>({ action: 'prefs-set', patch }).then((answer) => answer.prefs)

/** Tell the server about a failure on this device (see report.ts). Never carries mail text. */
export const report = (fault: { place: string; message: string; detail?: unknown; version: string; device: string }) =>
  call<{ ok: true }>({ action: 'report', ...fault })
