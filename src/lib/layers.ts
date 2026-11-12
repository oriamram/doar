import { useEffect, useRef } from 'react'

/**
 * Makes the phone's Back gesture (and the browser's Back button) close whatever
 * is open on top (an email, the compose form, a menu) instead of leaving the app.
 *
 * While anything is open, one extra "guard" entry sits in the browser history.
 * Back steps off the guard: we close the top layer, and put the guard back if
 * more layers remain. When the last layer is closed from the screen, the guard
 * is removed. Where we stand is read from the history entry itself, never
 * counted, so several layers closing at once can't put it out of step.
 */

type Layer = { close: () => void }

const layers: Layer[] = []
/** True while a history step we made ourselves (removing the guard) is on its way. */
let ownStep = false
let disarmTimer: ReturnType<typeof setTimeout> | undefined

const onGuard = () => (history.state as { doarGuard?: boolean } | null)?.doarGuard === true

// A guard left over from before a reload has nothing to go back to in this page.
if (onGuard()) history.replaceState(null, '')

/** Make sure Back has a guard entry to step off, while something is open. */
function arm() {
  if (layers.length > 0 && !onGuard()) history.pushState({ doarGuard: true }, '')
}

/** Nothing is open any more: take the guard out of the history (once things settle). */
function disarmSoon() {
  clearTimeout(disarmTimer)
  disarmTimer = setTimeout(() => {
    if (layers.length > 0 || !onGuard()) return
    ownStep = true
    history.back()
  }, 0)
}

window.addEventListener('popstate', () => {
  if (ownStep) ownStep = false
  else layers.pop()?.close() // The user pressed Back.
  if (layers.length > 0) arm()
  else if (onGuard()) disarmSoon()
})

function pushLayer(close: () => void): () => void {
  const layer: Layer = { close }
  layers.push(layer)
  arm()
  return () => {
    const index = layers.indexOf(layer)
    if (index === -1) return // Back already closed it.
    layers.splice(index, 1)
    if (layers.length === 0) disarmSoon()
  }
}

/** True while something is open that Back should close. */
export const hasOpenLayers = () => layers.length > 0

/** While `open` is true, Back calls `close` instead of leaving. */
export function useBackLayer(open: boolean, close: () => void) {
  const latestClose = useRef(close)
  useEffect(() => {
    latestClose.current = close
  })
  useEffect(() => {
    if (!open) return
    return pushLayer(() => latestClose.current())
  }, [open])
}
