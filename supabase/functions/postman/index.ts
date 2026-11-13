// postman: what Doar's server does while the app is closed.
//
//   Scheduled sending   keeps a draft's id and a time, and tells Gmail to send the draft
//                       when the time comes. The letter itself stays in Gmail's Drafts.
//   New-mail alerts     looks at each subscribed mailbox once a minute and sends a
//                       notification (sender, subject, first words) to the person's
//                       browsers. Nothing it reads is stored.
//   Automatic labels    on the same look, a new letter from a sender the person listed
//                       gets the Gmail label they chose for that sender.
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
//
// Called by the database's timer every minute (header x-cron-secret, see the migration):
//   POST { action: "tick" }
//
// Uses the secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (shared with google-token).
// Deployed with verify_jwt off because it checks the caller itself.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { labelsFor, normalizeMatch, type Rule } from './rules.ts'
import { createVapidKeys, sendPush, type PushResult, type VapidKeys } from './webpush.ts'

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

/** Turn "=?UTF-8?B?…?=" in a mail header back into text. */
function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_match, charset: string, kind: string, text: string) => {
    try {
      let bytes: Uint8Array
      if (kind.toLowerCase() === 'b') {
        bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
      } else {
        const out: number[] = []
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '_') out.push(32)
          else if (text[i] === '=' && i + 2 < text.length) {
            out.push(parseInt(text.slice(i + 1, i + 3), 16))
            i += 2
          } else out.push(text.charCodeAt(i))
        }
        bytes = new Uint8Array(out)
      }
      return new TextDecoder(charset).decode(bytes)
    } catch {
      return text
    }
  })
}

function senderName(from: string): string {
  const decoded = decodeWords(from).trim()
  const match = decoded.match(/^"?([^"<]*)"?\s*<([^>]+)>/)
  const name = match?.[1]?.trim()
  if (name) return name
  const email = (match?.[2] ?? decoded).trim()
  return email.split('@')[0] || email
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Gmail's preview text comes with HTML entities. */
function plain(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/g, (match, name: string) => ENTITIES[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim()
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

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

type Report = { sent: number; failed: number; retried: number; checked: number; labeled: number; notified: number; errors: string[] }

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
    .select('history_id, scope, needs_reauth, reauth_at')
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

    const { data: ruleRows } = await admin.from('label_rules').select('id, match, label_id').eq('user_id', userId)
    const rules = (ruleRows ?? []) as Rule[]

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
    // deno-lint-ignore no-explicit-any
    const header = (body: any, name: string): string =>
      (body.payload?.headers ?? []).find((h: { name: string }) => h.name.toLowerCase() === name)?.value ?? ''

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

    if (latest.size === 0) {
      await done(next)
      return
    }

    // Read sender and subject; skip anything read or filed in the meantime.
    const letters: { threadId: string; from: string; subject: string; preview: string }[] = []
    for (const ref of [...latest.values()].slice(-8)) {
      const message = await read(ref.id)
      if (message.status !== 200 || !wanted(message.body.labelIds ?? [], watch.scope)) continue
      letters.push({
        threadId: message.body.threadId,
        from: senderName(header(message.body, 'from')),
        subject: plain(decodeWords(header(message.body, 'subject'))) || '(בלי נושא)',
        preview: plain(message.body.snippet ?? ''),
      })
    }
    if (letters.length === 0) {
      await done(next)
      return
    }

    const inbox = await gmail(token, '/labels/INBOX')
    const unread = inbox.status === 200 ? Number(inbox.body.threadsUnread ?? 0) : undefined

    if (letters.length <= 3) {
      for (const letter of letters) {
        await pushTo(userId, {
          type: 'mail',
          threadId: letter.threadId,
          title: clip(letter.from, 60),
          body: clip(letter.preview ? `${letter.subject}\n${letter.preview}` : letter.subject, 220),
          unread,
        })
      }
    } else {
      const names = [...new Set(letters.map((letter) => letter.from))]
      await pushTo(userId, {
        type: 'summary',
        title: `${letters.length} מכתבים חדשים`,
        body: clip(names.join(', '), 200),
        unread,
      })
    }
    report.notified += letters.length
    await done(next)
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
}

const SCHEDULED_FIELDS = 'id, draft_id, thread_id, message_id, send_at, status, error'

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

async function tick(): Promise<Report> {
  const report: Report = { sent: 0, failed: 0, retried: 0, checked: 0, labeled: 0, notified: 0, errors: [] }

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

  // Everyone who wants notifications, and everyone who has automatic labels.
  const [{ data: subscribers }, { data: ruleOwners }] = await Promise.all([
    admin.from('push_subscriptions').select('user_id'),
    admin.from('label_rules').select('user_id'),
  ])
  const notified = new Set((subscribers ?? []).map((row) => row.user_id as string))
  const users = new Set([...notified, ...(ruleOwners ?? []).map((row) => row.user_id as string)])
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

// deno-lint-ignore no-explicit-any
async function fromApp(userId: string, body: any): Promise<Response> {
  switch (body.action) {
    case 'status': {
      const [{ data: watch }, { data: subscriptions }, scheduled, { data: rules }] = await Promise.all([
        admin.from('mail_watch').select('scope').eq('user_id', userId).maybeSingle(),
        admin.from('push_subscriptions').select('endpoint').eq('user_id', userId),
        listScheduled(userId),
        admin.from('label_rules').select('id, match, label_id').eq('user_id', userId).order('created_at'),
      ])
      return json({
        scope: watch?.scope ?? 'important',
        endpoints: (subscriptions ?? []).map((row) => row.endpoint),
        scheduled,
        rules: rules ?? [],
      })
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
