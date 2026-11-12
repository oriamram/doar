import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { initAuth } from './lib/auth'
import { isNative } from './lib/platform'
// Applies the saved day/night theme as soon as the app's code runs.
import './lib/settings'
import './index.css'

initAuth()

// The service worker makes the PC/browser version installable and work offline.
// The Android app already bundles its files, so it doesn't need one.
if (!isNative) registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
