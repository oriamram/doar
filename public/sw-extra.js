// Added to the generated service worker (see vite.config.ts). It runs even when Doar is closed.
//
//   - shows the notifications that Doar's server sends (new mail, a scheduled letter that failed)
//   - opens the right letter when a notification is tapped
//   - catches things shared into Doar from other apps, and hands them to the app as a new letter

const ICON = '/pwa-192x192.png'
// Android draws this one in a single color, from its shape alone.
const BADGE = '/badge-96.png'
const SHARE_CACHE = 'doar-share'

const openWindows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true })

/** Where tapping a notification leads. */
function target(data) {
  if ((data.type === 'mail' || data.type === 'returned' || data.type === 'no-reply') && data.threadId) return `/?thread=${encodeURIComponent(data.threadId)}`
  if (data.type === 'send-failed') return '/?view=scheduled'
  return '/'
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Not a message from Doar's server.
  }
  event.waitUntil(
    (async () => {
      const windows = await openWindows()
      if (data.type === 'mail' || data.type === 'summary' || data.type === 'returned' || data.type === 'no-reply') {
        // An open Doar refreshes its list; the app's icon shows how many are unread.
        for (const client of windows) client.postMessage({ type: 'doar-new-mail' })
        if (typeof data.unread === 'number' && self.navigator.setAppBadge) self.navigator.setAppBadge(data.unread).catch(() => {})
        // Looking at Doar right now: the letter just appears in the list, with no interruption.
        if (windows.some((client) => client.visibilityState === 'visible' && client.focused)) return
      }
      // Buttons need the signed ticket the server sent along, and the address to hand it back to.
      const actions = data.ticket && data.act && Array.isArray(data.actions) ? data.actions.slice(0, 2) : []
      await self.registration.showNotification(data.title || 'דואר', {
        body: data.body || '',
        icon: ICON,
        badge: BADGE,
        // One notification per conversation: a newer letter replaces the older note.
        tag: data.threadId ? `doar-thread-${data.threadId}` : `doar-${data.type || 'note'}`,
        renotify: true,
        dir: 'rtl',
        lang: 'he',
        actions,
        data: { url: target(data), ticket: data.ticket, act: data.act },
      })
    })(),
  )
})

/** Bring Doar to the front (or open it) on the letter a notification was about. */
async function openDoar(url) {
  const open = (await openWindows()).find((client) => 'focus' in client)
  if (open) {
    await open.focus()
    open.postMessage({ type: 'doar-open', url })
    return
  }
  await self.clients.openWindow(url)
}

// A tap on a notification opens its letter. A tap on one of its buttons ("file", "read",
// "remind me again") is done right here: the ticket goes back to Doar's server, which
// does it in Gmail, and Doar stays closed.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = data.url || '/'
  event.waitUntil(
    (async () => {
      if (!event.action || !data.ticket || !data.act) return openDoar(url)
      try {
        const answer = await fetch(data.act, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ticket', ticket: data.ticket, do: event.action }),
        })
        if (!answer.ok) throw new Error(`ticket ${answer.status}`)
        // An open Doar shows the change.
        for (const client of await openWindows()) client.postMessage({ type: 'doar-new-mail' })
      } catch {
        // The button could not do its job (no connection, or the ticket is too old): open the letter instead.
        await openDoar(url)
      }
    })(),
  )
})

// "Share" from another app arrives as a form posted to /share. Put it aside and open
// Doar, which turns it into a new letter (src/lib/launch.ts).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST' || new URL(event.request.url).pathname !== '/share') return
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData()
        await caches.delete(SHARE_CACHE)
        const cache = await caches.open(SHARE_CACHE)
        const files = form.getAll('files').filter((item) => item instanceof File)
        const meta = {
          title: String(form.get('title') || ''),
          text: String(form.get('text') || ''),
          url: String(form.get('url') || ''),
          files: files.map((file, index) => ({ name: file.name, type: file.type, key: `/__share/file-${index}` })),
        }
        await cache.put('/__share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }))
        for (const [index, file] of files.entries()) {
          await cache.put(`/__share/file-${index}`, new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }))
        }
      } catch {
        // Nothing usable was shared; Doar just opens.
      }
      return Response.redirect('/?share=1', 303)
    })(),
  )
})
