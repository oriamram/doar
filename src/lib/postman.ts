import { supabase } from './supabase'

/**
 * The app's side of the `postman` Edge Function: the part of Doar that works while
 * the app is closed (scheduled sending and new-mail notifications).
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
}

/** Mail from `match` (a full address, or a whole site written "@site") gets the label by itself. */
export type LabelRule = { id: string; match: string; labelId: string }

export type ServerStatus = { scope: NotifyScope; endpoints: string[]; scheduled: ScheduledSend[]; rules: LabelRule[] }

type Row = { id: string; draft_id: string; thread_id: string | null; message_id: string | null; send_at: string; status: ScheduledSend['status']; error: string | null }

const fromRow = (row: Row): ScheduledSend => ({
  id: row.id,
  draftId: row.draft_id,
  threadId: row.thread_id,
  messageId: row.message_id,
  sendAt: row.send_at,
  status: row.status,
  error: row.error,
})

type RuleRow = { id: string; match: string; label_id: string }

const fromRule = (row: RuleRow): LabelRule => ({ id: row.id, match: row.match, labelId: row.label_id })

/** The server said no; `code` says why ("too_late", "draft_missing", "reauth"…). */
export class PostmanError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
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

export async function serverStatus(): Promise<ServerStatus> {
  const status = await call<{ scope: NotifyScope; endpoints: string[]; scheduled: Row[]; rules?: RuleRow[] }>({ action: 'status' })
  return {
    scope: status.scope,
    endpoints: status.endpoints,
    scheduled: status.scheduled.map(fromRow),
    rules: (status.rules ?? []).map(fromRule),
  }
}

export const pushKey = () => call<{ publicKey: string }>({ action: 'push-key' }).then((answer) => answer.publicKey)

export const pushSubscribe = (subscription: { endpoint: string; p256dh: string; auth: string }, device: string) =>
  call<{ ok: true }>({ action: 'push-subscribe', ...subscription, device })

export const pushUnsubscribe = (endpoint: string) => call<{ ok: true }>({ action: 'push-unsubscribe', endpoint })

export const pushTest = () =>
  call<{ results: { device: string; status: number; detail?: string }[] }>({ action: 'push-test' }).then((answer) => answer.results)

export const pushScope = (scope: NotifyScope) => call<{ ok: true }>({ action: 'push-scope', scope })

export const scheduleCreate = (draftId: string, sendAt: Date) =>
  call<{ scheduled: Row }>({ action: 'schedule-create', draft_id: draftId, send_at: sendAt.toISOString() }).then((answer) => fromRow(answer.scheduled))

export const scheduleUpdate = (id: string, sendAt: Date) =>
  call<{ scheduled: Row }>({ action: 'schedule-update', id, send_at: sendAt.toISOString() }).then((answer) => fromRow(answer.scheduled))

export const scheduleCancel = (id: string) => call<{ ok: true }>({ action: 'schedule-cancel', id })

/** `from` is whatever the person typed; the server tidies it into an address or a site, or refuses it. */
export const ruleCreate = (from: string, labelId: string) =>
  call<{ rule: RuleRow }>({ action: 'rule-create', match: from, label_id: labelId }).then((answer) => fromRule(answer.rule))

export const ruleDelete = (id: string) => call<{ ok: true }>({ action: 'rule-delete', id })
