import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by hand in main.tsx, the way every app on the desk does it (packages/core/appUpdate.ts).
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon-48.png', 'apple-touch-icon-180x180.png'],
      workbox: {
        // A new version takes over as soon as it's downloaded, instead of waiting for every open tab to close.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The font too, so the app opens whole with no connection: the notes themselves are on the device.
        globPatterns: ['**/*.{js,css,html,svg,ttf}'],
      },
      manifest: {
        id: '/',
        name: 'פתקיות',
        short_name: 'פתקיות',
        lang: 'he',
        dir: 'rtl',
        description: 'פתקים לעצמך, על השולחן',
        theme_color: '#24407a',
        background_color: '#d7cdbc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Doar's dev server and preview keep 5173 and 4173; the notes stand one door down.
  server: { port: 5174 },
  preview: { port: 4174 },
})
