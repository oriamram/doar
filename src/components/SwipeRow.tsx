import { useDrag } from '@use-gesture/react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { tapHaptic } from '../lib/platform'

type Props = {
  children: ReactNode
  /** Swipe left: the row flies off and is filed (archived). */
  onArchive: () => void
  /** Swipe right: the row springs back after toggling read/unread. */
  onToggleRead: () => void
  unread: boolean
}

type Armed = 'archive' | 'read' | null

/** Fraction of the row width a swipe must pass to trigger. */
const THRESHOLD = 0.3

/** Rubber stamp: faint while you drag, thumps into place once the swipe will trigger. */
const stampPose = (active: boolean, rotate: number) =>
  active ? { scale: 1, opacity: 1, rotate } : { scale: 0.72, opacity: 0.45, rotate: rotate / 3 }

const thump = { type: 'spring', stiffness: 700, damping: 17 } as const

export function SwipeRow({ children, onArchive, onToggleRead, unread }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const armedRef = useRef<Armed>(null)
  const [armed, setArmed] = useState<Armed>(null)
  const dragged = useRef(false)
  const x = useMotionValue(0)
  const archiveOpacity = useTransform(x, [-60, -12], [1, 0])
  const readOpacity = useTransform(x, [12, 60], [0, 1])

  const setArmedSide = (next: Armed) => {
    if (next === armedRef.current) return
    armedRef.current = next
    setArmed(next)
    if (next) tapHaptic()
  }

  const bind = useDrag(
    ({ down, movement: [mx], velocity: [vx], direction: [dx] }) => {
      const width = rowRef.current?.offsetWidth ?? 1
      const past = Math.abs(mx) > width * THRESHOLD
      if (Math.abs(mx) > 4) dragged.current = true

      if (down) {
        x.set(mx)
        setArmedSide(past ? (mx < 0 ? 'archive' : 'read') : null)
        return
      }

      setArmedSide(null)
      const flung = vx > 0.6 && Math.sign(dx) === Math.sign(mx) && Math.abs(mx) > 24
      if ((past || flung) && mx < 0) {
        void animate(x, -width, { duration: 0.18 }).then(onArchive)
      } else {
        if ((past || flung) && mx > 0) onToggleRead()
        void animate(x, 0, { type: 'spring', stiffness: 520, damping: 42 })
      }
    },
    { axis: 'x', filterTaps: true },
  )

  return (
    // Gesture handlers go on this plain element; the motion.div below just moves.
    <div className="swipe" ref={rowRef} {...bind()} style={{ touchAction: 'pan-y' }}>
      <motion.div className="swipe-bg swipe-bg--read" style={{ opacity: readOpacity }} aria-hidden="true">
        <motion.span className="rubber" animate={stampPose(armed === 'read', 8)} transition={thump}>
          {unread ? 'נקרא' : 'לא נקרא'}
        </motion.span>
      </motion.div>
      <motion.div className="swipe-bg swipe-bg--archive" style={{ opacity: archiveOpacity }} aria-hidden="true">
        <motion.span className="rubber" animate={stampPose(armed === 'archive', -10)} transition={thump}>
          תויק
        </motion.span>
      </motion.div>
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
