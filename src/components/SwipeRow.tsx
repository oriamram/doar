import { useDrag } from '@use-gesture/react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useRef, type ReactNode } from 'react'
import { tapHaptic } from '../lib/platform'
import { ArchiveIcon, MailOpenIcon } from './icons'

type Props = {
  children: ReactNode
  /** Swipe left: the row flies off and is removed. */
  onArchive: () => void
  /** Swipe right: the row springs back after toggling read/unread. */
  onToggleRead: () => void
  unread: boolean
}

/** Fraction of the row width a swipe must pass to trigger. */
const THRESHOLD = 0.3

export function SwipeRow({ children, onArchive, onToggleRead, unread }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const armed = useRef(false)
  const dragged = useRef(false)
  const x = useMotionValue(0)
  const archiveOpacity = useTransform(x, [-80, -16], [1, 0])
  const readOpacity = useTransform(x, [16, 80], [0, 1])

  const bind = useDrag(
    ({ down, movement: [mx], velocity: [vx], direction: [dx] }) => {
      const width = rowRef.current?.offsetWidth ?? 1
      const past = Math.abs(mx) > width * THRESHOLD
      if (Math.abs(mx) > 4) dragged.current = true

      if (down) {
        x.set(mx)
        if (past !== armed.current) {
          armed.current = past
          if (past) tapHaptic()
        }
        return
      }

      armed.current = false
      const flung = vx > 0.6 && Math.sign(dx) === Math.sign(mx) && Math.abs(mx) > 24
      if ((past || flung) && mx < 0) {
        void animate(x, -width, { duration: 0.16 }).then(onArchive)
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
      <motion.div className="swipe-bg swipe-bg--read" style={{ opacity: readOpacity }}>
        <MailOpenIcon />
        <span>{unread ? 'Read' : 'Unread'}</span>
      </motion.div>
      <motion.div className="swipe-bg swipe-bg--archive" style={{ opacity: archiveOpacity }}>
        <span>Archive</span>
        <ArchiveIcon />
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
