import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { initAuth } from './lib/auth'
import { isNative } from './lib/platform'
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
