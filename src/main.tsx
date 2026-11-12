import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { keepAppUpdated } from './lib/appUpdate'
import { initAuth } from './lib/auth'
import { isNative } from './lib/platform'
// Applies the saved day/night theme as soon as the app's code runs.
import './lib/settings'
import './index.css'

initAuth()

// The Android app already bundles its files, so it needs no service worker;
// neither does the dev server, where it would only get in the way.
if (!isNative && import.meta.env.PROD) keepAppUpdated()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
