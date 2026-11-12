import { useDrag } from '@use-gesture/react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { tapHaptic } from '../lib/platform'

/** What a swipe does: the word its rubber stamp shows, and the action. */
export type SwipeAction = { label: string; run: () => void }

type Props = {
  children: ReactNode
  /** Swipe left: the letter flies off and this runs (filing, restoring…). */
  left?: SwipeAction
  /** Swipe right: the letter springs back after this runs (read / unread). */
  right?: SwipeAction
  disabled?: boolean
}

type Armed = 'left' | 'right' | null

/** Fraction of the row width a swipe must pass to trigger. */
const THRESHOLD = 0.3

/** Rubber stamp: faint while you drag, thumps into place once the swipe will trigger. */
const stampPose = (active: boolean, rotate: number) =>
  active ? { scale: 1, opacity: 1, rotate } : { scale: 0.72, opacity: 0.45, rotate: rotate / 3 }

const thump = { type: 'spring', stiffness: 700, damping: 17 } as const

export function SwipeRow({ children, left, right, disabled }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const armedRef = useRef<Armed>(null)
  const [armed, setArmed] = useState<Armed>(null)
  const dragged = useRef(false)
  const x = useMotionValue(0)
  const leftOpacity = useTransform(x, [-60, -12], [1, 0])
  const rightOpacity = useTransform(x, [12, 60], [0, 1])

  const setArmedSide = (next: Armed) => {
    if (next === armedRef.current) return
    armedRef.current = next
    setArmed(next)
    if (next) tapHaptic()
  }

  const bind = useDrag(
    ({ down, movement: [mx], velocity: [vx], direction: [dx] }) => {
      if (disabled) return
      const width = rowRef.current?.offsetWidth ?? 1
      // A side with nothing to do resists: the letter barely moves.
      const available = mx < 0 ? left : right
      const travel = available ? mx : mx * 0.15
      const past = !!available && Math.abs(mx) > width * THRESHOLD
      if (Math.abs(mx) > 4) dragged.current = true

      if (down) {
        x.set(travel)
        setArmedSide(past ? (mx < 0 ? 'left' : 'right') : null)
        return
      }

      setArmedSide(null)
      const flung = !!available && vx > 0.6 && Math.sign(dx) === Math.sign(mx) && Math.abs(mx) > 24
      if ((past || flung) && mx < 0 && left) {
        void animate(x, -width, { duration: 0.18 }).then(() => {
          left.run()
          // In folders where the letter stays on the list (say, "all mail"), it slides back.
          void animate(x, 0, { type: 'spring', stiffness: 520, damping: 42 })
        })
      } else {
        if ((past || flung) && mx > 0) right?.run()
        void animate(x, 0, { type: 'spring', stiffness: 520, damping: 42 })
      }
    },
    { axis: 'x', filterTaps: true },
  )

  return (
    // Gesture handlers go on this plain element; the motion.div below just moves.
    <div className="swipe" ref={rowRef} {...bind()} style={{ touchAction: 'pan-y' }}>
      {right && (
        <motion.div className="swipe-bg swipe-bg--right" style={{ opacity: rightOpacity }} aria-hidden="true">
          <motion.span className="rubber" animate={stampPose(armed === 'right', 8)} transition={thump}>
            {right.label}
          </motion.span>
        </motion.div>
      )}
      {left && (
        <motion.div className="swipe-bg swipe-bg--left" style={{ opacity: leftOpacity }} aria-hidden="true">
          <motion.span className="rubber" animate={stampPose(armed === 'left', -10)} transition={thump}>
            {left.label}
          </motion.span>
        </motion.div>
      )}
      <motion.div
        className="swipe-fg"
        style={{ x }}
        onPointerDown={() => (dragged.current = false)}
        // A drag shouldn't also count as a click that opens the email.
        onClickCapture={(e) => {
          if (dragged.current) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        {children}
      </motion.div>
    </div>
  )
}
