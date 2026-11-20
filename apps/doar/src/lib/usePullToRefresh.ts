import { animate, useMotionValue } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { tapHaptic } from './platform'

export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing'

/** How far (px) the list must be pulled before letting go checks the mail. */
export const PULL_THRESHOLD = 76
/** Where the list rests while the mail is being checked. */
const PULL_HOLD = 92
/** Show the delivery at least this long, so a fast answer doesn't flash by. */
const MIN_REFRESH_MS = 900

const settle = { type: 'spring', stiffness: 420, damping: 36 } as const

/**
 * Pull-to-refresh on touch screens: drag the list down from its top, let go past
 * the threshold, and `onRefresh` runs. `pull` is how far the list is pulled (px),
 * for moving the list and drawing the indicator behind it.
 */
export function usePullToRefresh(element: HTMLElement | null, onRefresh: () => Promise<unknown>) {
  const pull = useMotionValue(0)
  const [phase, setPhase] = useState<PullPhase>('idle')
  const phaseRef = useRef<PullPhase>('idle')
  const refreshRef = useRef(onRefresh)

  useEffect(() => {
    refreshRef.current = onRefresh
  })

  useEffect(() => {
    if (!element) return
    const list = element
    let startX = 0
    let startY = 0
    // off: not ours. deciding: finger down at the top, direction unknown. pulling: ours.
    let gesture: 'off' | 'deciding' | 'pulling' = 'off'

    const go = (next: PullPhase) => {
      if (phaseRef.current === next) return
      if (next === 'armed') tapHaptic()
      phaseRef.current = next
      setPhase(next)
    }

    const onStart = (e: TouchEvent) => {
      if (phaseRef.current === 'refreshing' || list.scrollTop > 0 || e.touches.length !== 1) return
      startX = e.touches[0]!.clientX
      startY = e.touches[0]!.clientY
      gesture = 'deciding'
    }

    const onMove = (e: TouchEvent) => {
      if (gesture === 'off') return
      const dx = e.touches[0]!.clientX - startX
      const dy = e.touches[0]!.clientY - startY
      if (gesture === 'deciding') {
        if (Math.hypot(dx, dy) < 8) return
        // Sideways is a swipe on a letter, upward is a scroll: not a pull.
        if (dy <= 0 || Math.abs(dx) > dy || list.scrollTop > 0) {
          gesture = 'off'
          return
        }
        gesture = 'pulling'
      }
      if (e.cancelable) e.preventDefault()
      // Rubber band: the further you pull, the harder it gets.
      const distance = 140 * (1 - Math.exp(-Math.max(0, dy) / 180))
      pull.set(distance)
      go(distance >= PULL_THRESHOLD ? 'armed' : 'pulling')
    }

    const onEnd = () => {
      const wasPulling = gesture === 'pulling'
      gesture = 'off'
      if (!wasPulling) return
      if (phaseRef.current !== 'armed') {
        go('idle')
        void animate(pull, 0, settle)
        return
      }
      go('refreshing')
      void animate(pull, PULL_HOLD, settle)
      const minimum = new Promise((resolve) => setTimeout(resolve, MIN_REFRESH_MS))
      void Promise.allSettled([refreshRef.current(), minimum]).then(() => {
        go('idle')
        void animate(pull, 0, settle)
      })
    }

    list.addEventListener('touchstart', onStart, { passive: true })
    list.addEventListener('touchmove', onMove, { passive: false })
    list.addEventListener('touchend', onEnd)
    list.addEventListener('touchcancel', onEnd)
    return () => {
      list.removeEventListener('touchstart', onStart)
      list.removeEventListener('touchmove', onMove)
      list.removeEventListener('touchend', onEnd)
      list.removeEventListener('touchcancel', onEnd)
    }
  }, [element, pull])

  return { pull, phase }
}
