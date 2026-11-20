import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { keepAppUpdated } from '@doar/core/appUpdate.ts'
import App from './App.tsx'
import { hand } from './lib/store.ts'
import './styles.css'

// Day or night follows the device, also when it changes while the app is open.
const night = window.matchMedia('(prefers-color-scheme: dark)')
const light = () => {
  document.documentElement.dataset.theme = night.matches ? 'dark' : 'light'
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', night.matches ? '#131922' : '#d7cdbc')
}
light()
night.addEventListener('change', light)

// A page reloaded with a note in hand starts with the note back on the desk; the phone's
// Back must not think one is still open.
if (window.history.state?.note) window.history.replaceState(null, '')

// The dev server needs no service worker; there it would only get in the way.
if (import.meta.env.PROD) keepAppUpdated(() => hand.busy)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
