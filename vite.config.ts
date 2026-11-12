import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by hand in main.tsx, and only in the browser (not inside the Android app).
      injectRegister: false,
      includeAssets: ['favicon.ico', 'logo.svg', 'apple-touch-icon-180x180.png'],
      workbox: {
        // Keep the textures and the font on the device too, so the app opens whole when offline.
        globPatterns: ['**/*.{js,css,html,svg,ttf}'],
        // Opens the app when a "new mail" notification is tapped.
        importScripts: ['sw-extra.js'],
      },
      manifest: {
        name: 'דואר',
        short_name: 'דואר',
        lang: 'he',
        dir: 'rtl',
        description: 'הג׳ימייל שלך, עד הבית',
        theme_color: '#a63a26',
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
  server: {
    port: 5173,
    // Capacitor copies the build into android/; don't reload the page when that happens.
    watch: { ignored: ['**/android/**'] },
  },
})
