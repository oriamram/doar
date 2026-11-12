// Added to the generated service worker (see vite.config.ts).
// Tapping a "new mail" notification brings Doar to the front, or opens it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => 'focus' in client)
      return open ? open.focus() : self.clients.openWindow('/')
    }),
  )
})
