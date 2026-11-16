// postman: what Doar's server does while the app is closed.
//
//   Scheduled sending   keeps a draft's id and a time, and tells Gmail to send the draft
//                       when the time comes. The letter itself stays in Gmail's Drafts.
//   New-mail alerts     looks at each subscribed mailbox once a minute and sends a
//                       notification (sender, subject, first words) to the person's
//                       browsers. Nothing it reads is stored.
//   Automatic labels    on the same look, a new letter from a sender the person listed
//                       gets the Gmail label they chose for that sender.
//   Held mail           brings a conversation back to the inbox at the time the person chose.
//   Registered mail     tells the person when a letter they sent got no answer in time.
//   Sender marks        "express" senders always notify at once; "refused" senders' mail goes
//                       straight to the bin.
//   Opening hours       outside them notifications wait, and one summary is sent at opening time.
//   Also kept for the app: preferences shared by a person's devices, notes on letters,
//                       and reports of failures on a device (never mail text).
//
// Called by the app, with the person's Supabase session:
//   POST { action: "status" }                               { scope, endpoints, scheduled, rules }
//   POST { action: "push-key" }                             { publicKey }
//   POST { action: "push-subscribe", endpoint, p256dh, auth, device }
//   POST { action: "push-unsubscribe", endpoint }
//   POST { action: "push-test" }                            { results: [{ device, status }] }
//   POST { action: "push-scope", scope }                    "all" | "important" | "primary"
//   POST { action: "schedule-create", draft_id, send_at }   { scheduled }
//   POST { action: "schedule-update", id, send_at }         { scheduled }
//   POST { action: "schedule-cancel", id }                  { ok }
//   POST { action: "rule-create", match, label_id, existing }   { rule, labeled, thread_ids }
//        match: an address or a domain; existing: also label that sender's mail already here
//   POST { action: "rule-delete", id }                      { ok }
//   POST { action: "hold-create", thread_id, due_at }       { reminder }
//   POST { action: "reply-create", thread_id, after_message_id, days }   { reminder }
//   POST { action: "reminder-update", id, due_at }          { reminder }
//   POST { action: "reminder-cancel", id }                  { ok }
//   POST { action: "mark-set", match, mark, on }            { mark }   mark: "express" | "refused"
//   POST { action: "hours-set", hours }                     { hours }  null switches them off
//   POST { action: "note-set", thread_id, text }            { ok }     empty text removes the note
//   POST { action: "unsubscribe", message_id }              { done, mailto, url }
//   POST { action: "prefs-set", patch }                     { prefs }
//   POST { action: "report", place, message, detail, version, device }
//   POST { action: "widget-key-create", device }            { key, widget }  connects a home-screen widget
//   POST { action: "widget-key-delete", id }                { ok }
//
// Called by the home-screen widget on an Android phone, with the key it was given (see widget.ts):
//   POST { action: "widget", key }                          { at, unread, more, letters }
//
// Called by the service worker when a button on a notification is pressed, with the
// signed ticket that came inside that notification (no session needed):
//   POST { action: "ticket", ticket, do }                   do: "read" | "archive" | "drop" | "again"
//
// Called by the database's timer every minute (header x-cron-secret, see the migration):
//   POST { action: "tick" }
//
// Uses the secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (shared with google-token).
// Deployed with verify_jwt off because it checks the caller itself.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { findCode, formatCode } from './codes.ts'
import { isOpen, validHours } from './hours.ts'
import { replyState, validDays, validDue } from './reminders.ts'
import { labelsFor, matches, normalizeMatch, senderAddress, type Rule } from './rules.ts'
import { clip, decodeWords, plain, senderName } from './text.ts'
import { readTicket, signTicket } from './tickets.ts'
import { createVapidKeys, sendPush, type PushResult, type VapidKeys } from './webpush.ts'
import { newWidgetKey, validWidgetKey, widgetKeyHash, widgetLetter, widgetQuery } from './widget.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) return JSON.parse(keys).default
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
/** Who is sending the notifications, as push services ask to be told. */
const SENDER = 'https://doar-henna.vercel.app'
const SCOPES = ['all', 'important', 'primary']
/** This function's own address: where a button on a notification reports back to. */
const SELF = `${Deno.env.get('SUPABASE_URL')}/functions/v1/postman`
const DAY = 86_400_000

const now = () => new Date().toISOString()
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Google no longer accepts our token for this person; they have to sign in again. */
class Reauth extends Error {}

// ---------- Keys the server keeps for itself ----------

const keyCache = new Map<string, string>()

async function serverKey(name: string): Promise<string | null> {
  const cached = keyCache.get(name)
  if (cached) return cached
  const { data } = await admin.from('server_keys').select('value').eq('name', name).maybeSingle()
  if (data?.value) keyCache.set(name, data.value)
  return data?.value ?? null
}

/** The notification signing keys, made on first use and never shown to anyone. */
async function vapid(): Promise<VapidKeys> {
  const saved = await serverKey('vapid')
  if (saved) return JSON.parse(saved)
  // Two cold starts can both get here; the first insert wins and both read it back.
  await admin.from('server_keys').insert({ name: 'vapid', value: JSON.stringify(await createVapidKeys()) })
  const { data } = await admin.from('server_keys').select('value').eq('name', 'vapid').single()
  keyCache.set('vapid', data!.value)
  return JSON.parse(data!.value)
}

// ---------- Gmail ----------

/** A Gmail access token for this person, reused until shortly before it expires. */
async function googleToken(userId: string): Promise<string> {
  const { data: watch } = await admin
    .from('mail_watch')
    .select('access_token, access_expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (watch?.access_token && watch.access_expires_at && Date.parse(watch.access_expires_at) > Date.now() + 120_000) {
    return watch.access_token
  }

  const { data: row } = await admin.from('google_tokens').select('refresh_token').eq('user_id', userId).maybeSingle()
  if (!row) throw new Reauth()
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const token = await response.json()
  if (!response.ok) {
    if (token.error === 'invalid_grant') throw new Reauth()
    throw new Error(`Google token refresh failed: ${token.error}`)
  }
  await admin.from('mail_watch').upsert(
    {
      user_id: userId,
      access_token: token.access_token,
      access_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      updated_at: now(),
    },
    { onConflict: 'user_id' },
  )
  return token.access_token
}

// deno-lint-ignore no-explicit-any
async function gmail(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${GMAIL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(20_000),
  })
  let body = null
  try {
    body = await response.json()
  } catch {
    // An empty answer is fine; the status says enough.
  }
  return { status: response.status, body }
}

// ---------- Notifications ----------

type Sent = PushResult & { device: string }

/** Send one notification to every browser this person subscribed with. */
async function pushTo(userId: string, payload: Record<string, unknown>): Promise<Sent[]> {
  const { data: subscriptions } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, device')
    .eq('user_id', userId)
  if (!subscriptions?.length) return []
  const keys = await vapid()
  const results = await Promise.all(
    subscriptions.map(async (subscription) => ({
      subscription,
      result: await sendPush(subscription, payload, keys, { subject: SENDER }),
    })),
  )

  const gone = results.filter((r) => r.result.gone).map((r) => r.subscription.endpoint)
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone)
  const delivered = results.filter((r) => r.result.status >= 200 && r.result.status < 300).map((r) => r.subscription.endpoint)
  if (delivered.length) await admin.from('push_subscriptions').update({ last_ok_at: now() }).in('endpoint', delivered)
  for (const { subscription, result } of results) {
    if (result.status < 200 || result.status >= 300) {
      console.warn('push refused', new URL(subscription.endpoint).host, result.status, result.detail)
    }
  }
  return results.map(({ subscription, result }) => ({ ...result, device: subscription.device }))
}

type MessageRef = { id: string; threadId: string; labelIds?: string[] }

/** Mail carrying one of these is not mail that just arrived for the person. */
const NOT_INCOMING = ['SENT', 'DRAFT', 'SPAM', 'TRASH']

const incoming = (labels: string[]) => labels.includes('INBOX') && !labels.some((label) => NOT_INCOMING.includes(label))

/** Is this a letter the person asked to hear about? */
function wanted(labels: string[], scope: string): boolean {
  if (!incoming(labels) || !labels.includes('UNREAD')) return false
  const noise = labels.some((label) => label === 'CATEGORY_PROMOTIONS' || label === 'CATEGORY_SOCIAL' || label === 'CATEGORY_FORUMS')
  if (scope === 'all') return true
  if (scope === 'primary') return !noise && !labels.includes('CATEGORY_UPDATES')
  return !noise
}

type Report = {
  sent: number
  failed: number
  retried: number
  checked: number
  labeled: number
  notified: number
  /** Held and registered letters brought back to the inbox. */
  returned: number
  /** Letters from refused senders put in the bin. */
  refused: number
  errors: string[]
}

// deno-lint-ignore no-explicit-any
const headerOf = (message: any, name: string): string =>
  (message?.payload?.headers ?? []).find((h: { name: string }) => h.name.toLowerCase() === name)?.value ?? ''

/** The buttons on a new-mail notification (phones show two). */
const MAIL_ACTIONS = [
  { action: 'archive', title: 'לתיוק' },
  { action: 'read', title: 'נקרא' },
]

/**
 * Look for mail that arrived since the last look: put the person's automatic labels on
 * it, and (when `notify`) tell their browsers about it.
 */
async function checkMail(userId: string, notify: boolean, report: Report) {
  await admin.from('mail_watch').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  // Take the mailbox for two minutes, so an overlapping timer skips it instead of notifying twice.
  const { data: watch } = await admin
    .from('mail_watch')
    .update({ checking_until: new Date(Date.now() + 120_000).toISOString() })
    .eq('user_id', userId)
    .or(`checking_until.is.null,checking_until.lt."${now()}"`)
    .select('history_id, scope, needs_reauth, reauth_at, hours, held_threads')
    .maybeSingle()
  if (!watch) return

  const done = (patch: Record<string, unknown> = {}) =>
    admin.from('mail_watch').update({ checking_until: null, updated_at: now(), ...patch }).eq('user_id', userId)

  try {
    if (watch.needs_reauth) {
      // Wait for a fresh sign-in (google-token saves a new refresh token then).
      const { data: saved } = await admin.from('google_tokens').select('updated_at').eq('user_id', userId).maybeSingle()
      if (!saved || (watch.reauth_at && Date.parse(saved.updated_at) <= Date.parse(watch.reauth_at))) {
        await done()
        return
      }
    }

    let token: string
    try {
      token = await googleToken(userId)
    } catch (error) {
      if (!(error instanceof Reauth)) throw error
      if (!watch.needs_reauth) {
        await pushTo(userId, { type: 'reauth', title: 'דואר', body: 'צריך להתחבר מחדש כדי להמשיך לקבל התראות.' })
      }
      await done({ needs_reauth: true, reauth_at: now(), access_token: null, access_expires_at: null })
      return
    }
    report.checked++

    const [{ data: ruleRows }, { data: markRows }] = await Promise.all([
      admin.from('label_rules').select('id, match, label_id').eq('user_id', userId),
      admin.from('sender_marks').select('match, mark').eq('user_id', userId),
    ])
    const rules = (ruleRows ?? []) as Rule[]
    const marked = (mark: string) => (markRows ?? []).filter((row) => row.mark === mark).map((row) => row.match as string)
    const express = marked('express')
    const refused = marked('refused')

    const bookmark = async () => {
      const profile = await gmail(token, '/profile')
      return profile.status === 200 ? String(profile.body.historyId) : null
    }

    // The first look only places the bookmark: mail that was already there is not news.
    if (!watch.history_id) {
      await done({ history_id: await bookmark(), needs_reauth: false })
      return
    }

    const history = await gmail(
      token,
      `/history?startHistoryId=${watch.history_id}&historyTypes=messageAdded&labelId=INBOX&maxResults=100`,
    )
    if (history.status === 404) {
      // The bookmark is too old for Gmail; start again from now.
      await done({ history_id: await bookmark(), needs_reauth: false })
      return
    }
    if (history.status === 401) {
      await done({ access_token: null, access_expires_at: null })
      return
    }
    if (history.status !== 200) throw new Error(`Gmail history ${history.status}`)

    // Every new message in the inbox, and the latest one of each conversation worth a notification.
    const arrived = new Map<string, MessageRef>()
    const latest = new Map<string, MessageRef>()
    for (const entry of history.body.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const message = added.message as MessageRef
        if (incoming(message.labelIds ?? [])) arrived.set(message.id, message)
        if (notify && wanted(message.labelIds ?? [], watch.scope)) latest.set(message.threadId, message)
      }
    }
    const next = { history_id: String(history.body.historyId ?? watch.history_id), needs_reauth: false }

    // Sender and subject of a message, asked of Gmail once however many times they are needed.
    // deno-lint-ignore no-explicit-any
    const asked = new Map<string, Promise<{ status: number; body: any }>>()
    const read = (id: string) => {
      let answer = asked.get(id)
      if (!answer) {
        answer = gmail(
          token,
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&fields=id,threadId,labelIds,snippet,payload/headers`,
        )
        asked.set(id, answer)
      }
      return answer
    }
    const header = headerOf

    // Mail from a sender the person refused goes straight to the bin, and is not announced.
    if (refused.length) {
      for (const ref of [...arrived.values()].slice(-60)) {
        const message = await read(ref.id)
        if (message.status !== 200) continue
        const address = senderAddress(header(message.body, 'from'))
        if (!refused.some((match) => matches(match, address))) continue
        const binned = await gmail(token, `/messages/${ref.id}/trash`, { method: 'POST' })
        if (binned.status !== 200) continue
        report.refused++
        arrived.delete(ref.id)
        if (latest.get(ref.threadId)?.id === ref.id) latest.delete(ref.threadId)
      }
    }

    // New mail in a conversation settles what was waiting on it: a held letter is back by
    // itself, and a registered letter has its answer.
    const touched = [...new Set([...arrived.values()].map((message) => message.threadId))]
    if (touched.length) {
      const settle = (kind: string, status: string) =>
        admin.from('reminders').update({ status, done_at: now() }).eq('user_id', userId).eq('kind', kind).eq('status', 'waiting').in('thread_id', touched)
      await Promise.all([settle('hold', 'cancelled'), settle('reply', 'answered')])
    }

    // Automatic labels first, so a letter already wears its label when its notification arrives.
    if (rules.length) {
      for (const ref of [...arrived.values()].slice(-60)) {
        const message = await read(ref.id)
        if (message.status !== 200) continue
        const has: string[] = message.body.labelIds ?? []
        const add = labelsFor(rules, header(message.body, 'from')).filter((label) => !has.includes(label))
        if (add.length === 0) continue
        const changed = await gmail(token, `/messages/${ref.id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: add }) })
        if (changed.status === 200) report.labeled++
        else console.warn('label not applied', changed.status, changed.body?.error?.message)
      }
    }

    if (!notify) {
      await done(next)
      return
    }

    // Read sender and subject; skip anything read or filed in the meantime.
    const letters: { threadId: string; from: string; subject: string; preview: string; code: string | null; urgent: boolean }[] = []
    for (const ref of [...latest.values()].slice(-8)) {
      const message = await read(ref.id)
      if (message.status !== 200 || !wanted(message.body.labelIds ?? [], watch.scope)) continue
      const from = header(message.body, 'from')
      const subject = plain(decodeWords(header(message.body, 'subject'))) || '(בלי נושא)'
      const preview = plain(message.body.snippet ?? '')
      const code = findCode(subject, preview)
      const address = senderAddress(from)
      letters.push({
        threadId: message.body.threadId,
        from: senderName(from),
        subject,
        preview,
        code,
        // A code is no use in the morning, and an express sender was promised to get through.
        urgent: !!code || express.some((match) => matches(match, address)),
      })
    }

    // Outside opening hours only urgent letters are announced; the rest wait for opening time.
    const hours = validHours(watch.hours)
    const open = !hours || isOpen(hours, new Date())
    const announce = open ? letters : letters.filter((letter) => letter.urgent)
    let held: string[] = watch.held_threads ?? []
    if (!open) held = [...new Set([...held, ...letters.filter((letter) => !letter.urgent).map((letter) => letter.threadId)])].slice(-50)
    const flush = open && held.length > 0
    if (announce.length === 0 && !flush) {
      await done({ ...next, held_threads: held })
      return
    }

    const inbox = await gmail(token, '/labels/INBOX')
    const unread = inbox.status === 200 ? Number(inbox.body.threadsUnread ?? 0) : undefined

    // Opening time: one note about what arrived while it was closed and is still unread.
    if (flush) {
      const names: string[] = []
      for (const id of held.filter((id) => !announce.some((letter) => letter.threadId === id)).slice(-12)) {
        const thread = await gmail(token, `/threads/${id}?format=metadata&metadataHeaders=From&fields=messages(labelIds,payload/headers)`)
        if (thread.status !== 200) continue
        // deno-lint-ignore no-explicit-any
        const fresh = (thread.body.messages ?? []).findLast((message: any) => incoming(message.labelIds ?? []) && message.labelIds.includes('UNREAD'))
        if (fresh) names.push(senderName(header(fresh, 'from')))
      }
      if (names.length > 0) {
        await pushTo(userId, {
          type: 'summary',
          title: names.length === 1 ? 'בזמן שהיה סגור הגיע מכתב אחד' : `בזמן שהיה סגור הגיעו ${names.length} מכתבים`,
          body: clip([...new Set(names)].join(', '), 200),
          unread,
        })
        report.notified += names.length
      }
      held = []
    }

    if (announce.length > 0 && announce.length <= 3) {
      const secret = await serverKey('ticket_secret')
      for (const letter of announce) {
        const ticket = secret ? await signTicket({ u: userId, t: letter.threadId, e: Date.now() + 2 * DAY }, secret) : null
        await pushTo(userId, {
          type: 'mail',
          threadId: letter.threadId,
          title: letter.code ? `קוד: ${formatCode(letter.code)}` : clip(letter.from, 60),
          body: letter.code
            ? clip(`${letter.from} · ${letter.subject}`, 220)
            : clip(letter.preview ? `${letter.subject}\n${letter.preview}` : letter.subject, 220),
          unread,
          ...(ticket ? { ticket, act: SELF, actions: MAIL_ACTIONS } : {}),
        })
      }
    } else if (announce.length > 3) {
      const names = [...new Set(announce.map((letter) => letter.from))]
      await pushTo(userId, {
        type: 'summary',
        title: `${announce.length} מכתבים חדשים`,
        body: clip(names.join(', '), 200),
        unread,
      })
    }
    report.notified += announce.length
    await done({ ...next, held_threads: held })
  } catch (error) {
    report.errors.push(`mail: ${errorText(error)}`)
    await done()
  }
}

// ---------- Scheduled sending ----------

type Scheduled = {
  id: string
  user_id: string
  draft_id: string
  thread_id: string | null
  message_id: string | null
  send_at: string
  status: string
  attempts: number
  error: string | null
  /** Registered: when it goes out, start waiting this many days for an answer. */
  followup_days: number | null
}

const SCHEDULED_FIELDS = 'id, draft_id, thread_id, message_id, send_at, status, error, followup_days'

const FAILURES: Record<string, string> = {
  reauth: 'צריך להתחבר מחדש לדואר ולשלוח אותו שוב.',
  draft_missing: 'הטיוטה נמחקה או כבר נשלחה.',
  unknown_outcome: 'לא ברור אם המכתב נשלח. כדאי לבדוק בתיקייה „נשלחו”.',
  gmail_unavailable: 'Gmail לא היה זמין. המכתב מחכה בטיוטות.',
}

async function sendFailed(row: Scheduled, code: string, report: Report) {
  report.failed++
  await admin.from('scheduled_sends').update({ status: 'failed', error: code, updated_at: now() }).eq('id', row.id)
  await pushTo(row.user_id, {
    type: 'send-failed',
    title: 'מכתב מתוזמן לא נשלח',
    body: FAILURES[code] ?? 'Gmail סירב לשלוח את המכתב. הוא מחכה בטיוטות.',
  })
}

/** Send one letter whose time has come. Its row is already marked "sending". */
async function deliver(row: Scheduled, report: Report) {
  const retry = async (code: string) => {
    if (row.attempts >= 3) return sendFailed(row, code, report)
    report.retried++
    await admin.from('scheduled_sends').update({ status: 'pending', error: code, updated_at: now() }).eq('id', row.id)
  }
  try {
    const token = await googleToken(row.user_id)
    const result = await gmail(token, '/drafts/send', { method: 'POST', body: JSON.stringify({ id: row.draft_id }) })
    if (result.status === 200) {
      report.sent++
      await admin.from('scheduled_sends').update({ status: 'sent', sent_at: now(), error: null, updated_at: now() }).eq('id', row.id)
      const days = validDays(row.followup_days)
      const threadId = result.body?.threadId ?? row.thread_id
      if (days && threadId && result.body?.id) {
        await admin.from('reminders').insert({
          user_id: row.user_id,
          kind: 'reply',
          thread_id: threadId,
          after_message_id: result.body.id,
          days,
          due_at: new Date(Date.now() + days * DAY).toISOString(),
        })
      }
    } else if (result.status === 404) {
      // After an attempt whose answer never arrived, a missing draft means that attempt went through.
      if (row.attempts > 1) {
        report.sent++
        await admin.from('scheduled_sends').update({ status: 'sent', sent_at: now(), error: 'unconfirmed', updated_at: now() }).eq('id', row.id)
      } else await sendFailed(row, 'draft_missing', report)
    } else if (result.status === 401) {
      await admin.from('mail_watch').update({ access_token: null, access_expires_at: null }).eq('user_id', row.user_id)
      await retry('reauth')
    } else if (result.status === 429 || result.status >= 500) {
      await retry('gmail_unavailable')
    } else {
      console.warn('scheduled send refused', result.status, result.body?.error?.message)
      await sendFailed(row, `gmail_${result.status}`, report)
    }
  } catch (error) {
    if (error instanceof Reauth) await sendFailed(row, 'reauth', report)
    else await retry('gmail_unavailable')
  }
}

// ---------- Held mail and registered mail ----------

type Reminder = {
  id: string
  user_id: string
  kind: 'hold' | 'reply'
  thread_id: string
  after_message_id: string | null
  days: number | null
  due_at: string
  attempts: number
}

const REMINDER_FIELDS = 'id, kind, thread_id, after_message_id, days, due_at, status, done_at'

/** A reminder whose time has come. Its row is already marked "working". */
async function remind(row: Reminder, report: Report) {
  const finish = (status: string) => admin.from('reminders').update({ status, done_at: now() }).eq('id', row.id)
  // Not now (Gmail is busy, or the person must sign in again): the next minute tries again, a few times.
  const later = () => admin.from('reminders').update({ status: row.attempts >= 30 ? 'failed' : 'waiting' }).eq('id', row.id)

  let token: string
  try {
    token = await googleToken(row.user_id)
  } catch (error) {
    await later()
    if (!(error instanceof Reauth)) throw error
    return
  }
  const thread = await gmail(
    token,
    `/threads/${row.thread_id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&fields=messages(id,labelIds,internalDate,payload/headers)`,
  )
  if (thread.status === 404) {
    await finish('cancelled')
    return
  }
  if (thread.status !== 200) {
    if (thread.status === 401) await admin.from('mail_watch').update({ access_token: null, access_expires_at: null }).eq('user_id', row.user_id)
    await later()
    return
  }
  // deno-lint-ignore no-explicit-any
  const messages: any[] = (thread.body.messages ?? []).filter((message: any) => !(message.labelIds ?? []).includes('DRAFT'))
  const last = messages.at(-1)
  if (!last || messages.every((message) => (message.labelIds ?? []).includes('TRASH'))) {
    await finish('cancelled')
    return
  }

  if (row.kind === 'reply') {
    const state = replyState({ messages }, row.after_message_id ?? '')
    if (state !== 'waiting') {
      await finish(state === 'answered' ? 'answered' : 'cancelled')
      return
    }
  } else if (incoming(last.labelIds ?? [])) {
    // New mail already brought the conversation back.
    await finish('cancelled')
    return
  }

  // Back to the inbox, with its latest letter unread so that it stands out.
  const back = await gmail(token, `/threads/${row.thread_id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: ['INBOX'] }) })
  if (back.status !== 200) {
    await later()
    return
  }
  await gmail(token, `/messages/${last.id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: ['UNREAD'] }) })
  await finish('returned')
  report.returned++

  const subject = plain(decodeWords(headerOf(last, 'subject'))) || '(בלי נושא)'
  const secret = await serverKey('ticket_secret')
  const ticket = secret
    ? await signTicket(
        { u: row.user_id, t: row.thread_id, e: Date.now() + 2 * DAY, k: row.kind, ...(row.kind === 'reply' ? { d: row.days ?? 3, m: row.after_message_id ?? '' } : {}) },
        secret,
      )
    : null
  const buttons = (again: string, drop: string) => (ticket ? { ticket, act: SELF, actions: [{ action: 'again', title: again }, { action: 'drop', title: drop }] } : {})
  if (row.kind === 'hold') {
    await pushTo(row.user_id, {
      type: 'returned',
      threadId: row.thread_id,
      title: 'חזר מהדואר השמור',
      body: clip(`${senderName(headerOf(last, 'from'))} · ${subject}`, 220),
      ...buttons('להזכיר שוב מחר', 'לתיוק'),
    })
  } else {
    const to = senderName(headerOf(messages.find((message) => message.id === row.after_message_id) ?? last, 'to'))
    await pushTo(row.user_id, {
      type: 'no-reply',
      threadId: row.thread_id,
      title: 'עדיין אין תשובה',
      body: clip(`אל ${to} · ${subject}`, 220),
      ...buttons('להזכיר שוב', 'לוותר'),
    })
  }
}

async function tick(): Promise<Report> {
  const report: Report = { sent: 0, failed: 0, retried: 0, checked: 0, labeled: 0, notified: 0, returned: 0, refused: 0, errors: [] }

  // A send that started long ago and never reported back: its outcome is unknown, so it is not repeated.
  const { data: lost } = await admin
    .from('scheduled_sends')
    .update({ status: 'failed', error: 'unknown_outcome', updated_at: now() })
    .eq('status', 'sending')
    .lt('updated_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .select()
  for (const row of (lost ?? []) as Scheduled[]) {
    report.failed++
    await pushTo(row.user_id, { type: 'send-failed', title: 'מכתב מתוזמן לא נשלח', body: FAILURES.unknown_outcome })
  }

  const { data: due, error } = await admin.rpc('claim_due_sends')
  if (error) report.errors.push(`claim: ${error.message}`)
  for (const row of (due ?? []) as Scheduled[]) await deliver(row, report)

  // Held letters to bring back, and registered letters to ask about.
  const { data: reminders, error: remindError } = await admin.rpc('claim_due_reminders')
  if (remindError) report.errors.push(`reminders: ${remindError.message}`)
  for (const row of (reminders ?? []) as Reminder[]) {
    try {
      await remind(row, report)
    } catch (error) {
      report.errors.push(`reminder: ${errorText(error)}`)
      await admin.from('reminders').update({ status: row.attempts >= 30 ? 'failed' : 'waiting' }).eq('id', row.id).eq('status', 'working')
    }
  }

  // Everyone who wants notifications, everyone who has automatic labels, and everyone who refused a sender.
  const [{ data: subscribers }, { data: ruleOwners }, { data: refusers }] = await Promise.all([
    admin.from('push_subscriptions').select('user_id'),
    admin.from('label_rules').select('user_id'),
    admin.from('sender_marks').select('user_id').eq('mark', 'refused'),
  ])
  const notified = new Set((subscribers ?? []).map((row) => row.user_id as string))
  const users = new Set([...notified, ...(ruleOwners ?? []).map((row) => row.user_id as string), ...(refusers ?? []).map((row) => row.user_id as string)])
  await Promise.all([...users].map((userId) => checkMail(userId, notified.has(userId), report)))
  return report
}

// ---------- Automatic labels ----------

/** Put a label on the mail from a sender that is already in the mailbox (up to 1000 messages). */
async function labelExisting(token: string, sender: string, labelId: string): Promise<{ messages: number; threads: string[] }> {
  const ids: string[] = []
  const threads = new Set<string>()
  let pageToken = ''
  do {
    const page = await gmail(
      token,
      `/messages?maxResults=500&q=${encodeURIComponent(`from:(${sender})`)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    )
    if (page.status !== 200) throw new Error(`Gmail search ${page.status}`)
    for (const message of (page.body.messages ?? []) as MessageRef[]) {
      if (ids.length >= 1000) break
      ids.push(message.id)
      threads.add(message.threadId)
    }
    pageToken = page.body.nextPageToken ?? ''
  } while (pageToken && ids.length < 1000)

  if (ids.length) {
    const changed = await gmail(token, '/messages/batchModify', { method: 'POST', body: JSON.stringify({ ids, addLabelIds: [labelId] }) })
    if (changed.status !== 204 && changed.status !== 200) throw new Error(`Gmail label ${changed.status}`)
  }
  return { messages: ids.length, threads: [...threads] }
}

// ---------- Requests from the app ----------

function validTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  // Between half a minute from now and a year from now.
  if (Number.isNaN(time) || time < Date.now() + 30_000 || time > Date.now() + 366 * 86_400_000) return null
  return new Date(time).toISOString()
}

async function listScheduled(userId: string) {
  const { data } = await admin
    .from('scheduled_sends')
    .select(SCHEDULED_FIELDS)
    .eq('user_id', userId)
    .in('status', ['pending', 'sending', 'failed'])
    .order('send_at')
  return data ?? []
}

/** An id as Gmail writes them, or null. */
const idText = (value: unknown): string | null => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null)

/** A web address the server may be asked to call: an ordinary https site, never a number or a local name. */
function publicUrl(text: string): boolean {
  try {
    const url = new URL(text)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      (url.port === '' || url.port === '443') &&
      /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) &&
      !/(^|\.)(localhost|local|internal|lan|home|corp|test|example|invalid)$/i.test(url.hostname)
    )
  } catch {
    return false
  }
}

/** Make a reminder for a conversation, replacing one of the same kind that still waits. */
async function saveReminder(userId: string, values: { kind: 'hold' | 'reply'; thread_id: string; due_at: string; after_message_id?: string | null; days?: number | null }) {
  await admin
    .from('reminders')
    .update({ status: 'cancelled', done_at: now() })
    .eq('user_id', userId)
    .eq('thread_id', values.thread_id)
    .eq('kind', values.kind)
    .eq('status', 'waiting')
  return admin.from('reminders').insert({ user_id: userId, ...values }).select(REMINDER_FIELDS).maybeSingle()
}

// deno-lint-ignore no-explicit-any
async function fromApp(userId: string, body: any): Promise<Response> {
  switch (body.action) {
    case 'status': {
      const recently = new Date(Date.now() - 2 * DAY).toISOString()
      const [{ data: watch }, { data: subscriptions }, scheduled, { data: rules }, { data: prefs }, { data: reminders }, { data: marks }, { data: notes }, { data: reports }, { data: widgets }] =
        await Promise.all([
          admin.from('mail_watch').select('scope, hours, updated_at').eq('user_id', userId).maybeSingle(),
          admin.from('push_subscriptions').select('endpoint, device, last_ok_at').eq('user_id', userId).order('created_at'),
          listScheduled(userId),
          admin.from('label_rules').select('id, match, label_id').eq('user_id', userId).order('created_at'),
          admin.from('user_prefs').select('data').eq('user_id', userId).maybeSingle(),
          // What still waits, and what came back in the last two days (so the app can say "returned").
          admin
            .from('reminders')
            .select(REMINDER_FIELDS)
            .eq('user_id', userId)
            .or(`status.in.(waiting,working),and(status.eq.returned,done_at.gt."${recently}")`)
            .order('due_at'),
          admin.from('sender_marks').select('id, match, mark').eq('user_id', userId).order('created_at'),
          admin.from('notes').select('thread_id, text, updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(500),
          admin.from('client_reports').select('at, place, message').eq('user_id', userId).order('at', { ascending: false }).limit(1),
          admin.from('widget_keys').select('id, device, created_at, last_used_at').eq('user_id', userId).order('created_at'),
        ])
      return json({
        scope: watch?.scope ?? 'important',
        endpoints: (subscriptions ?? []).map((row) => row.endpoint),
        scheduled,
        rules: rules ?? [],
        devices: (subscriptions ?? []).map((row) => ({ device: row.device, last_ok_at: row.last_ok_at })),
        looked_at: watch?.updated_at ?? null,
        hours: validHours(watch?.hours),
        prefs: prefs?.data ?? null,
        reminders: reminders ?? [],
        marks: marks ?? [],
        notes: notes ?? [],
        last_report: reports?.[0] ?? null,
        widgets: widgets ?? [],
      })
    }

    case 'prefs-set': {
      const patch = body.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return json({ error: 'bad_prefs' }, 400)
      const { data: row } = await admin.from('user_prefs').select('data').eq('user_id', userId).maybeSingle()
      const data: Record<string, unknown> = { ...(row?.data ?? {}), ...patch }
      for (const key of Object.keys(data)) if (data[key] === null) delete data[key]
      if (JSON.stringify(data).length > 300_000) return json({ error: 'too_big' }, 413)
      const { error } = await admin.from('user_prefs').upsert({ user_id: userId, data, updated_at: now() }, { onConflict: 'user_id' })
      if (error) return json({ error: 'Could not save preferences' }, 500)
      return json({ prefs: data })
    }

    case 'widget-key-create': {
      const { count } = await admin.from('widget_keys').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      if ((count ?? 0) >= 10) return json({ error: 'too_many' }, 409)
      const key = newWidgetKey()
      const { data: widget, error } = await admin
        .from('widget_keys')
        .insert({ user_id: userId, key_hash: await widgetKeyHash(key), device: String(body.device ?? '').slice(0, 60) })
        .select('id, device, created_at, last_used_at')
        .single()
      if (error) return json({ error: 'Could not save the widget' }, 500)
      return json({ key, widget })
    }

    case 'widget-key-delete': {
      if (typeof body.id !== 'string') return json({ error: 'bad_id' }, 400)
      await admin.from('widget_keys').delete().eq('user_id', userId).eq('id', body.id)
      return json({ ok: true })
    }

    case 'report': {
      const text = (value: unknown, max: number) => String(value ?? '').slice(0, max)
      const { count } = await admin
        .from('client_reports')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('at', new Date(Date.now() - DAY).toISOString())
      // A device stuck in a loop must not fill the table.
      if ((count ?? 0) >= 300) return json({ ok: true, kept: false })
      let detail: unknown = null
      try {
        const raw = JSON.stringify(body.detail ?? null)
        detail = raw.length <= 6000 ? JSON.parse(raw) : { cut: raw.slice(0, 6000) }
      } catch {
        // Not something that can be stored; the message alone is kept.
      }
      await admin.from('client_reports').insert({
        user_id: userId,
        app_version: text(body.version, 40),
        device: text(body.device, 60),
        place: text(body.place, 80) || 'unknown',
        message: text(body.message, 600),
        detail,
      })
      return json({ ok: true, kept: true })
    }

    case 'hours-set': {
      const hours = body.hours === null ? null : validHours(body.hours)
      if (body.hours !== null && !hours) return json({ error: 'bad_hours' }, 400)
      // Switching the hours off leaves what was held: the next look announces it.
      const { error } = await admin.from('mail_watch').upsert({ user_id: userId, hours }, { onConflict: 'user_id' })
      if (error) return json({ error: 'Could not save hours' }, 500)
      return json({ hours })
    }

    case 'hold-create':
    case 'reply-create': {
      const hold = body.action === 'hold-create'
      const threadId = idText(body.thread_id)
      const days = hold ? null : validDays(body.days)
      const due = hold ? validDue(body.due_at) : days ? new Date(Date.now() + days * DAY).toISOString() : null
      const after = hold ? null : idText(body.after_message_id)
      if (!threadId || !due || (!hold && !after)) return json({ error: 'bad_time' }, 400)
      const { count } = await admin.from('reminders').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'waiting')
      if ((count ?? 0) >= 500) return json({ error: 'too_many' }, 409)
      const saved = await saveReminder(userId, { kind: hold ? 'hold' : 'reply', thread_id: threadId, due_at: due, after_message_id: after, days })
      if (saved.error || !saved.data) return json({ error: 'Could not save reminder' }, 500)
      return json({ reminder: saved.data })
    }

    case 'reminder-update': {
      const due = validDue(body.due_at)
      if (!due) return json({ error: 'bad_time' }, 400)
      const { data } = await admin
        .from('reminders')
        .update({ due_at: due })
        .eq('id', String(body.id ?? ''))
        .eq('user_id', userId)
        .eq('status', 'waiting')
        .select(REMINDER_FIELDS)
        .maybeSingle()
      return data ? json({ reminder: data }) : json({ error: 'too_late' }, 409)
    }

    case 'reminder-cancel':
      // Also clears a "returned" note the person has seen.
      await admin.from('reminders').delete().eq('id', String(body.id ?? '')).eq('user_id', userId).in('status', ['waiting', 'returned'])
      return json({ ok: true })

    case 'mark-set': {
      const match = normalizeMatch(String(body.match ?? ''))
      if (!match) return json({ error: 'bad_match' }, 400)
      if (body.mark !== 'express' && body.mark !== 'refused') return json({ error: 'bad_mark' }, 400)
      if (body.on === false) {
        await admin.from('sender_marks').delete().eq('user_id', userId).eq('match', match).eq('mark', body.mark)
        return json({ ok: true })
      }
      const { count } = await admin.from('sender_marks').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      if ((count ?? 0) >= 500) return json({ error: 'too_many' }, 409)
      await admin.from('sender_marks').upsert({ user_id: userId, match, mark: body.mark }, { onConflict: 'user_id,match,mark', ignoreDuplicates: true })
      const { data } = await admin.from('sender_marks').select('id, match, mark').eq('user_id', userId).eq('match', match).eq('mark', body.mark).maybeSingle()
      return data ? json({ mark: data }) : json({ error: 'Could not save mark' }, 500)
    }

    case 'note-set': {
      const threadId = idText(body.thread_id)
      if (!threadId) return json({ error: 'bad_note' }, 400)
      const text = String(body.text ?? '').trim().slice(0, 4000)
      const result = text
        ? await admin.from('notes').upsert({ user_id: userId, thread_id: threadId, text, updated_at: now() }, { onConflict: 'user_id,thread_id' })
        : await admin.from('notes').delete().eq('user_id', userId).eq('thread_id', threadId)
      return result.error ? json({ error: 'Could not save note' }, 500) : json({ ok: true })
    }

    case 'unsubscribe': {
      const messageId = idText(body.message_id)
      if (!messageId) return json({ error: 'message_missing' }, 404)
      let token: string
      try {
        token = await googleToken(userId)
      } catch (error) {
        if (error instanceof Reauth) return json({ error: 'reauth' }, 401)
        throw error
      }
      // The list's own instructions are read from the letter itself, not taken from the app.
      const message = await gmail(
        token,
        `/messages/${messageId}?format=metadata&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post&fields=payload/headers`,
      )
      if (message.status !== 200) return json({ error: 'message_missing' }, 404)
      const list = headerOf(message.body, 'list-unsubscribe')
      const url = /<(https:\/\/[^>\s]+)>/i.exec(list)?.[1] ?? null
      const mailto = /<mailto:([^>\s]+)>/i.exec(list)?.[1] ?? null
      // "One click": the list promises that this one request, with no page to fill in, takes the person off.
      if (url && /one-click/i.test(headerOf(message.body, 'list-unsubscribe-post')) && publicUrl(url)) {
        try {
          const answer = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'List-Unsubscribe=One-Click',
            redirect: 'manual',
            signal: AbortSignal.timeout(10_000),
          })
          if (answer.status < 400) return json({ done: 'posted', mailto, url })
        } catch {
          // The list's site didn't answer; the app falls back to the other ways.
        }
      }
      return json({ done: null, mailto, url })
    }

    case 'push-key':
      return json({ publicKey: (await vapid()).publicKey })

    case 'push-subscribe': {
      const { endpoint, p256dh, auth } = body
      let host = ''
      try {
        const url = new URL(endpoint)
        if (url.protocol === 'https:') host = url.host
      } catch {
        // Not an address at all.
      }
      // Some browsers hand out a placeholder that can never receive anything.
      if (!host || host.endsWith('.invalid') || typeof p256dh !== 'string' || typeof auth !== 'string') {
        return json({ error: 'bad_subscription' }, 400)
      }
      const { error } = await admin.from('push_subscriptions').upsert(
        { endpoint, user_id: userId, p256dh, auth, device: String(body.device ?? '').slice(0, 60) },
        { onConflict: 'endpoint' },
      )
      if (error) return json({ error: 'Could not save subscription' }, 500)
      // Place the bookmark now, so the first notification is about mail that arrives from here on.
      const { data: watch } = await admin.from('mail_watch').select('history_id').eq('user_id', userId).maybeSingle()
      if (!watch?.history_id) {
        try {
          const profile = await gmail(await googleToken(userId), '/profile')
          if (profile.status === 200) {
            await admin
              .from('mail_watch')
              .upsert({ user_id: userId, history_id: String(profile.body.historyId), needs_reauth: false }, { onConflict: 'user_id' })
          }
        } catch {
          // The timer places it on its first look instead.
        }
      }
      return json({ ok: true })
    }

    case 'push-unsubscribe':
      await admin.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', String(body.endpoint ?? ''))
      return json({ ok: true })

    case 'push-test': {
      const results = await pushTo(userId, { type: 'test', title: 'דואר', body: 'ההתראות פועלות במכשיר הזה.' })
      return json({ results: results.map(({ device, status, detail }) => ({ device, status, detail })) })
    }

    case 'push-scope': {
      if (!SCOPES.includes(body.scope)) return json({ error: 'bad_scope' }, 400)
      await admin.from('mail_watch').upsert({ user_id: userId, scope: body.scope }, { onConflict: 'user_id' })
      return json({ ok: true })
    }

    case 'schedule-create': {
      const sendAt = validTime(body.send_at)
      if (!sendAt || typeof body.draft_id !== 'string') return json({ error: 'bad_time' }, 400)
      // The draft must exist; Gmail also tells us which conversation it belongs to.
      let draft
      try {
        draft = await gmail(await googleToken(userId), `/drafts/${encodeURIComponent(body.draft_id)}?format=minimal`)
      } catch (error) {
        if (error instanceof Reauth) return json({ error: 'reauth' }, 401)
        throw error
      }
      if (draft.status !== 200) return json({ error: 'draft_missing' }, 404)
      const { count } = await admin
        .from('scheduled_sends')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending')
      if ((count ?? 0) >= 100) return json({ error: 'too_many' }, 409)

      const values = {
        user_id: userId,
        draft_id: body.draft_id,
        thread_id: draft.body.message?.threadId ?? null,
        message_id: draft.body.message?.id ?? null,
        send_at: sendAt,
        status: 'pending',
        attempts: 0,
        error: null,
        followup_days: validDays(body.followup_days),
        updated_at: now(),
      }
      // Scheduling a draft that already waits just moves its time.
      const { data: waiting } = await admin
        .from('scheduled_sends')
        .select('id')
        .eq('user_id', userId)
        .eq('draft_id', body.draft_id)
        .eq('status', 'pending')
        .maybeSingle()
      const saved = waiting
        ? await admin.from('scheduled_sends').update(values).eq('id', waiting.id).eq('status', 'pending').select(SCHEDULED_FIELDS).maybeSingle()
        : await admin.from('scheduled_sends').insert(values).select(SCHEDULED_FIELDS).maybeSingle()
      if (saved.error || !saved.data) return json({ error: 'Could not schedule' }, 500)
      return json({ scheduled: saved.data })
    }

    case 'schedule-update': {
      const sendAt = validTime(body.send_at)
      if (!sendAt) return json({ error: 'bad_time' }, 400)
      const { data } = await admin
        .from('scheduled_sends')
        .update({ send_at: sendAt, updated_at: now() })
        .eq('id', String(body.id ?? ''))
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select(SCHEDULED_FIELDS)
        .maybeSingle()
      // No row: the letter already left (or is leaving this second).
      return data ? json({ scheduled: data }) : json({ error: 'too_late' }, 409)
    }

    case 'schedule-cancel': {
      const { data } = await admin
        .from('scheduled_sends')
        .delete()
        .eq('id', String(body.id ?? ''))
        .eq('user_id', userId)
        .in('status', ['pending', 'failed'])
        .select('id')
        .maybeSingle()
      return data ? json({ ok: true }) : json({ error: 'too_late' }, 409)
    }

    case 'rule-create': {
      const match = normalizeMatch(String(body.match ?? ''))
      if (!match) return json({ error: 'bad_match' }, 400)
      if (typeof body.label_id !== 'string' || !body.label_id || body.label_id.length > 120) return json({ error: 'label_missing' }, 404)
      // The label must be one of this person's own Gmail labels.
      let token: string
      try {
        token = await googleToken(userId)
      } catch (error) {
        if (error instanceof Reauth) return json({ error: 'reauth' }, 401)
        throw error
      }
      const label = await gmail(token, `/labels/${encodeURIComponent(body.label_id)}`)
      if (label.status !== 200 || label.body.type !== 'user') return json({ error: 'label_missing' }, 404)
      const { count } = await admin.from('label_rules').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      if ((count ?? 0) >= 200) return json({ error: 'too_many' }, 409)

      // The same rule twice is one rule.
      await admin
        .from('label_rules')
        .upsert({ user_id: userId, match, label_id: body.label_id }, { onConflict: 'user_id,match,label_id', ignoreDuplicates: true })
      const { data } = await admin
        .from('label_rules')
        .select('id, match, label_id')
        .eq('user_id', userId)
        .eq('match', match)
        .eq('label_id', body.label_id)
        .maybeSingle()
      if (!data) return json({ error: 'Could not save rule' }, 500)
      if (body.existing !== true) return json({ rule: data })

      // The rule is saved either way; `labeled` is null if the older mail could not be labeled now.
      try {
        // A site is kept as "@site"; Gmail's search wants just the site.
        const found = await labelExisting(token, match.startsWith('@') ? match.slice(1) : match, body.label_id)
        return json({ rule: data, labeled: found.messages, thread_ids: found.threads })
      } catch (error) {
        console.warn('older mail not labeled', errorText(error))
        return json({ rule: data, labeled: null, thread_ids: [] })
      }
    }

    case 'rule-delete':
      await admin.from('label_rules').delete().eq('user_id', userId).eq('id', String(body.id ?? ''))
      return json({ ok: true })
  }
  return json({ error: 'Unknown action' }, 400)
}

/** The home-screen widget asks what is in the inbox (see widget.ts). */
// deno-lint-ignore no-explicit-any
async function forWidget(body: any): Promise<Response> {
  if (!validWidgetKey(body.key)) return json({ error: 'unknown_widget' }, 403)
  const { data: row } = await admin.from('widget_keys').select('id, user_id, last_used_at').eq('key_hash', await widgetKeyHash(body.key)).maybeSingle()
  if (!row) return json({ error: 'unknown_widget' }, 403)
  let token: string
  try {
    token = await googleToken(row.user_id)
  } catch (error) {
    if (error instanceof Reauth) return json({ error: 'reauth' }, 401)
    throw error
  }
  const { data: prefs } = await admin.from('user_prefs').select('data').eq('user_id', row.user_id).maybeSingle()
  const bundles = prefs?.data?.bundles !== false
  const search = (unreadOnly: boolean, max: number, fields: string) =>
    gmail(token, `/threads?maxResults=${max}&q=${encodeURIComponent(widgetQuery(bundles, unreadOnly))}&fields=${encodeURIComponent(fields)}`)
  const [list, unread] = await Promise.all([search(false, 12, 'threads/id'), search(true, 100, 'threads/id,nextPageToken')])
  if (list.status === 401 || unread.status === 401) return json({ error: 'reauth' }, 401)
  // With `fields`, Gmail answers an empty search with 204 and no body.
  const found = (answer: { status: number }) => answer.status === 200 || answer.status === 204
  if (!found(list) || !found(unread)) return json({ error: 'gmail' }, 502)
  const ids: string[] = (list.body?.threads ?? []).map((thread: { id: string }) => thread.id)
  const threads = await Promise.all(
    ids.map((id) =>
      gmail(
        token,
        `/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&fields=${encodeURIComponent('id,messages(labelIds,internalDate,snippet,payload/headers)')}`,
      ),
    ),
  )
  const letters = threads.flatMap((thread) => (thread.status === 200 && thread.body ? [widgetLetter(thread.body)] : [])).filter((letter) => letter !== null)
  // Once a quarter of an hour is enough to say "last seen" in Settings.
  if (!row.last_used_at || Date.parse(row.last_used_at) < Date.now() - 15 * 60_000) {
    await admin.from('widget_keys').update({ last_used_at: now() }).eq('id', row.id)
  }
  return json({ at: Date.now(), unread: (unread.body?.threads ?? []).length, more: !!unread.body?.nextPageToken, letters })
}

/** A button on a notification was pressed. The signed ticket inside the notification says for whom and on what. */
// deno-lint-ignore no-explicit-any
async function fromTicket(body: any): Promise<Response> {
  const secret = await serverKey('ticket_secret')
  const ticket = secret ? await readTicket(body.ticket, secret) : null
  if (!ticket || !idText(ticket.t)) return json({ error: 'bad_ticket' }, 403)
  let token: string
  try {
    token = await googleToken(ticket.u)
  } catch (error) {
    if (error instanceof Reauth) return json({ error: 'reauth' }, 401)
    throw error
  }
  const relabel = async (remove: string[]) => {
    const result = await gmail(token, `/threads/${ticket.t}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: remove }) })
    return result.status === 200
  }
  switch (body.do) {
    case 'read':
      return (await relabel(['UNREAD'])) ? json({ ok: true }) : json({ error: 'gmail' }, 502)
    case 'archive':
      return (await relabel(['INBOX'])) ? json({ ok: true }) : json({ error: 'gmail' }, 502)
    case 'drop':
      // "File it" or "give up" on a letter the server itself brought back: out of the inbox, and read.
      return (await relabel(['INBOX', 'UNREAD'])) ? json({ ok: true }) : json({ error: 'gmail' }, 502)
    case 'again': {
      if (ticket.k !== 'hold' && ticket.k !== 'reply') return json({ error: 'bad_ticket' }, 400)
      if (!(await relabel(['INBOX', 'UNREAD']))) return json({ error: 'gmail' }, 502)
      const days = ticket.k === 'reply' ? (validDays(ticket.d) ?? 3) : 1
      const saved = await saveReminder(ticket.u, {
        kind: ticket.k,
        thread_id: ticket.t,
        due_at: new Date(Date.now() + days * DAY).toISOString(),
        after_message_id: ticket.k === 'reply' ? (idText(ticket.m) ?? null) : null,
        days: ticket.k === 'reply' ? days : null,
      })
      return saved.error ? json({ error: 'Could not save reminder' }, 500) : json({ ok: true })
    }
  }
  return json({ error: 'Unknown action' }, 400)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    // A button on a notification (carries its own proof).
    if (body.action === 'ticket') return await fromTicket(body)
    // The home-screen widget (carries its own key).
    if (body.action === 'widget') return await forWidget(body)

    // The database's timer.
    const cronSecret = req.headers.get('x-cron-secret')
    if (cronSecret) {
      if (cronSecret !== (await serverKey('cron_secret')) || body.action !== 'tick') return json({ error: 'Forbidden' }, 403)
      return json(await tick())
    }

    // A signed-in Doar user.
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'Not signed in' }, 401)
    const { data: userData, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !userData.user) return json({ error: 'Not signed in' }, 401)
    return await fromApp(userData.user.id, body)
  } catch (error) {
    console.error('postman failed', body.action, errorText(error))
    return json({ error: 'Server error' }, 500)
  }
})
