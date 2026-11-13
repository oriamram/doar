// An end-to-end check of notifications, with a real browser and a real push service.
//
// It opens the built app in a hidden Edge window, lets the app's service worker
// subscribe to notifications, sends an encrypted notification through the browser's
// push service with the same code the server uses, and waits for the service worker
// to show it.
//
//   npm run build && npm run preview -- --port 4173 --strictPort      (in one terminal)
//   node --experimental-strip-types scripts/check-push-e2e.ts         (in another)

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVapidKeys, sendPush } from '../supabase/functions/postman/webpush.ts'

const SITE = 'http://localhost:4173'
const PORT = 9377
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A tiny Chrome DevTools Protocol client over Node's built-in WebSocket. */
function connect(url: string) {
  const socket = new WebSocket(url)
  let nextId = 1
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  const events: { method: string; params: any }[] = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id)!
      waiting.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    } else if (message.method) events.push(message)
  })
  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)))
  })
  const send = async (method: string, params: object = {}): Promise<any> => {
    await ready
    const id = nextId++
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
  }
  return { send, events, close: () => socket.close() }
}

const edgePath = EDGE.find((path) => existsSync(path))
if (!edgePath) throw new Error('Microsoft Edge was not found')
// A browser left over from an earlier run would answer on the same port, with its old state.
if (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false)) {
  throw new Error(`something already listens on port ${PORT}; close it and run again`)
}
const profile = mkdtempSync(join(tmpdir(), 'doar-push-'))
const edge = spawn(edgePath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], {
  stdio: 'ignore',
})

let failed = false
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}

try {
  // Wait for the browser, then find its control address and a page to drive.
  let version: { webSocketDebuggerUrl: string } | null = null
  for (let i = 0; i < 40 && !version; i++) {
    await sleep(250)
    version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json(), () => null)
  }
  if (!version) throw new Error('Edge did not start')
  const browser = connect(version.webSocketDebuggerUrl)
  await browser.send('Browser.grantPermissions', { origin: SITE, permissions: ['notifications'] })
  const { targetId } = await browser.send('Target.createTarget', { url: SITE })
  const targets = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as { id: string; webSocketDebuggerUrl: string }[]
  const page = connect(targets.find((target) => target.id === targetId)!.webSocketDebuggerUrl)
  await page.send('Runtime.enable')
  await page.send('ServiceWorker.enable')

  const evaluate = async (expression: string) => {
    const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  // The app registers its service worker by itself (src/lib/appUpdate.ts).
  const active = await evaluate(`navigator.serviceWorker.ready.then((registration) => registration.active.scriptURL)`)
  check('the app registered its service worker', String(active).endsWith('/sw.js'), String(active))
  check('notifications are allowed for the site', (await evaluate('Notification.permission')) === 'granted')

  // ---- 1. The service worker shows what the server sends (delivered straight to it).
  const registrationId = page.events.findLast((event) => event.method === 'ServiceWorker.workerRegistrationUpdated')?.params.registrations[0]?.registrationId
  const shown = async () =>
    evaluate(
      `navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((list) => list.map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data && n.data.url, dir: n.dir })))`,
    ) as Promise<{ title: string; body: string; tag: string; url: string; dir: string }[]>
  const deliver = (payload: object) =>
    page.send('ServiceWorker.deliverPushMessage', { origin: SITE, registrationId, data: JSON.stringify(payload) })

  const newMail = { type: 'mail', threadId: 'abc123', title: 'דנה כהן', body: 'פגישה מחר\nנתראה בעשר?', unread: 4 }

  // Doar is open and in front: the list updates itself, so no notification interrupts.
  await evaluate(`(window.__mail = 0, navigator.serviceWorker.addEventListener('message', (e) => e.data && e.data.type === 'doar-new-mail' && window.__mail++), 0)`)
  await deliver(newMail)
  await sleep(1200)
  let notes = await shown()
  const refreshes = await evaluate('window.__mail')
  check('with Doar in front, new mail refreshes the list instead of notifying', notes.length === 0 && refreshes === 1, `${notes.length} notifications, ${refreshes} refreshes`)

  // Doar is closed: the same message becomes a notification.
  await page.send('Page.navigate', { url: 'about:blank' })
  await sleep(800)
  await deliver(newMail)
  await deliver({ type: 'send-failed', title: 'מכתב מתוזמן לא נשלח', body: 'הטיוטה נמחקה או כבר נשלחה.' })
  await sleep(1500)
  await page.send('Page.navigate', { url: SITE })
  await sleep(2500)
  notes = await shown()
  const mail = notes.find((note) => note.tag === 'doar-thread-abc123')
  check('a new-mail message becomes a notification', mail?.title === 'דנה כהן' && mail.body.startsWith('פגישה מחר') && mail.dir === 'rtl', JSON.stringify(mail))
  check('tapping it would open that letter', mail?.url === '/?thread=abc123')
  check('a failed scheduled letter leads to the scheduled list', notes.find((note) => note.tag === 'doar-send-failed')?.url === '/?view=scheduled')
  await evaluate(`navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((list) => list.forEach((n) => n.close()))`)

  // ---- 1b. Buttons on a notification: pressing one hands the server's ticket back, and Doar stays closed.
  await page.send('Page.navigate', { url: 'about:blank' })
  await sleep(800)
  await deliver({
    type: 'mail',
    threadId: 't1',
    title: 'דנה כהן',
    body: 'פגישה מחר',
    ticket: 'ticket-123',
    act: `${SITE}/__ticket`,
    actions: [
      { action: 'archive', title: 'לתיוק' },
      { action: 'read', title: 'נקרא' },
      { action: 'third', title: 'אחד יותר מדי' },
    ],
  })
  await deliver({ type: 'returned', threadId: 't2', title: 'חזר מהדואר השמור', body: 'דנה כהן · פגישה' })
  await sleep(1500)
  await page.send('Page.navigate', { url: SITE })
  await sleep(2500)
  const withButtons = (await evaluate(
    `navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((list) => list.map((n) => ({ tag: n.tag, url: n.data && n.data.url, actions: (n.actions || []).map((a) => a.action + ':' + a.title) })))`,
  )) as { tag: string; url: string; actions: string[] }[]
  const mailNote = withButtons.find((note) => note.tag === 'doar-thread-t1')
  check('a new-mail notification carries two buttons', JSON.stringify(mailNote?.actions) === JSON.stringify(['archive:לתיוק', 'read:נקרא']), JSON.stringify(mailNote))
  const backNote = withButtons.find((note) => note.tag === 'doar-thread-t2')
  check('a letter that came back opens that letter, and has no buttons without a ticket', backNote?.url === '/?thread=t2' && backNote.actions.length === 0, JSON.stringify(backNote))

  // Press "file" inside the service worker itself, with its network replaced by a recorder.
  const workers = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as { type: string; url: string; webSocketDebuggerUrl: string }[]
  const workerTarget = workers.find((target) => target.type === 'service_worker' && target.url.endsWith('/sw.js'))
  if (!workerTarget) check('the service worker can be reached for the button press', false)
  else {
    const worker = connect(workerTarget.webSocketDebuggerUrl)
    const pressed = await worker.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const note = (await self.registration.getNotifications()).find((n) => n.tag === 'doar-thread-t1')
        const calls = []
        const real = self.fetch
        self.fetch = (url, init) => {
          calls.push({ url: String(url), method: init && init.method, body: init && init.body })
          return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
        }
        const waits = []
        const event = new NotificationEvent('notificationclick', { notification: note, action: 'archive' })
        event.waitUntil = (promise) => waits.push(promise)
        self.dispatchEvent(event)
        await Promise.all(waits)
        self.fetch = real
        return calls
      })()`,
    })
    const calls = (pressed.result?.value ?? []) as { url: string; method: string; body: string }[]
    const sent = calls.length === 1 ? (JSON.parse(calls[0]!.body) as { action: string; ticket: string; do: string }) : null
    check(
      'pressing "file" hands the ticket back to the server',
      !!sent && calls[0]!.url === `${SITE}/__ticket` && calls[0]!.method === 'POST' && sent.action === 'ticket' && sent.ticket === 'ticket-123' && sent.do === 'archive',
      JSON.stringify(calls).slice(0, 200),
    )
    worker.close()
  }
  await evaluate(`navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((list) => list.forEach((n) => n.close()))`)

  // ---- 2. Sharing into Doar: the worker catches the shared form and puts it aside for the app.
  const shared = (await evaluate(`(async () => {
    const form = new FormData()
    form.append('title', 'כותרת')
    form.append('text', 'שלום')
    form.append('url', 'https://example.com/page')
    form.append('files', new File(['hello'], 'note.txt', { type: 'text/plain' }))
    const response = await fetch('/share', { method: 'POST', body: form })
    const cache = await caches.open('doar-share')
    const meta = await (await cache.match('/__share/meta')).json()
    const file = await (await cache.match(meta.files[0].key)).text()
    await caches.delete('doar-share')
    return { landed: new URL(response.url).search, meta, file }
  })()`)) as { landed: string; meta: { title: string; text: string; url: string; files: { name: string; type: string }[] }; file: string }
  check(
    'something shared from another app is kept for a new letter',
    shared.landed === '?share=1' && shared.meta.title === 'כותרת' && shared.meta.text === 'שלום' && shared.meta.files[0]?.name === 'note.txt' && shared.file === 'hello',
    JSON.stringify(shared),
  )

  // ---- 3. The whole road: subscribe, encrypt, send through the push service, receive.
  const keys = await createVapidKeys()
  const subscription = (await evaluate(`(async () => {
    const registration = await navigator.serviceWorker.ready
    const key = Uint8Array.from(atob(${JSON.stringify(keys.publicKey)}.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    try {
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      return subscription.toJSON()
    } catch (error) {
      return { error: String(error) }
    }
  })()`)) as { endpoint?: string; keys?: { p256dh: string; auth: string }; error?: string }

  if (!subscription.endpoint || !subscription.keys) {
    console.log(`skip the push service leg: this browser could not subscribe (${subscription.error})`)
  } else {
    const host = new URL(subscription.endpoint).host
    check('the browser gave a real push address', !host.endsWith('.invalid'), host)
    const result = await sendPush(
      { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      { type: 'test', title: 'דואר', body: 'ההתראות פועלות במכשיר הזה.' },
      keys,
      { subject: 'https://doar-henna.vercel.app' },
    )
    check('the push service accepted the encrypted message', result.status >= 200 && result.status < 300, `${result.status} ${result.detail ?? ''}`)

    let arrived = false
    for (let i = 0; i < 40 && !arrived; i++) {
      await sleep(500)
      notes = await shown()
      arrived = notes.some((note) => note.tag === 'doar-test' && note.body === 'ההתראות פועלות במכשיר הזה.')
    }
    check('the notification arrived and was decrypted by the browser', arrived)
  }

  // Ask the browser to quit by itself; Edge runs as several processes, and this closes them all.
  await browser.send('Browser.close').catch(() => {})
  page.close()
  browser.close()
} finally {
  await sleep(800)
  if (process.platform === 'win32' && edge.pid) spawnSync('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' })
  else edge.kill()
  await sleep(500)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // Edge may still hold a file for a moment; the folder is in the system's temp directory.
  }
}

if (failed) process.exit(1)
