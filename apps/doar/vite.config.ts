import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** What "version" means for Doar: when it was built (UTC), and the commit when git can say. */
function appVersion(): string {
  const built = new Date().toISOString().slice(0, 16).replace('T', ' ')
  let commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? ''
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      // Built from a copy without git (a deploy upload): the time alone tells versions apart.
    }
  }
  return commit ? `${built} ${commit}` : built
}

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by hand in main.tsx, and only in the browser (not inside the Android app).
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo-envelope.webp', 'logo-envelope-small.webp', 'badge-96.png'],
      workbox: {
        // A new version takes over as soon as it's downloaded, instead of waiting for every
        // open tab to close (the plugin only sets these itself when it also registers the worker).
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The privacy page is its own page, not a screen of the app; the widget app is a file to download.
        navigateFallbackDenylist: [/^\/privacy/, /\.apk$/],
        // Keep the textures and the font on the device too, so the app opens whole when offline.
        globPatterns: ['**/*.{js,css,html,svg,ttf}'],
        // Notifications, opening the right letter from them, and "share to Doar" (public/sw-extra.js).
        importScripts: ['sw-extra.js'],
      },
      manifest: {
        id: '/',
        name: 'דואר',
        short_name: 'דואר',
        lang: 'he',
        dir: 'rtl',
        description: 'הג׳ימייל שלך, עד הבית',
        theme_color: '#a63a26',
        background_color: '#d7cdbc',
        display: 'standalone',
        start_url: '/',
        // Opening Doar again (a notification, a mail link) uses the window that's already open.
        launch_handler: { client_mode: ['focus-existing', 'auto'] },
        // Press and hold the icon (phone) or right-click it (PC): straight to a new letter.
        shortcuts: [
          {
            name: 'מכתב חדש',
            url: '/?compose=1',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // On the PC, clicking an email address on a web page can open a new letter here.
        protocol_handlers: [{ protocol: 'mailto', url: '/?mailto=%s' }],
        // On the phone, "Share" in other apps offers Doar; the shared thing becomes a new letter.
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['*/*'] }] },
        },
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Capacitor copies the build into android/; don't reload the page when that happens.
    watch: { ignored: ['**/android/**'] },
  },
})
