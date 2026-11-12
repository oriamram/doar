import { motion, useTransform, type MotionValue } from 'motion/react'
import { PULL_THRESHOLD, type PullPhase } from '../lib/usePullToRefresh'

const LABELS: Record<PullPhase, string> = {
  idle: '',
  pulling: 'משכו לבדיקת דואר',
  armed: 'שחררו, ונבדוק',
  refreshing: 'בודקים את תיבת הדואר…',
}

/**
 * Revealed behind the list as you pull it down: a brass mail slot in the door.
 * The further you pull, the further a letter slides out of it; while the mail is
 * being checked, letters keep dropping through.
 */
export function MailSlot({ pull, phase }: { pull: MotionValue<number>; phase: PullPhase }) {
  const opacity = useTransform(pull, [0, 26], [0, 1])
  const letterY = useTransform(pull, [10, PULL_THRESHOLD], [-30, 0])

  return (
    <div className="pull-zone" aria-hidden="true">
      <motion.div className="mail-slot" style={{ opacity }}>
        <span className="slot-plate">
          <span className="slot-gap" />
        </span>
        <span className="slot-window">
          <motion.svg
            className="slot-letter"
            data-dropping={phase === 'refreshing' || undefined}
            width="42"
            height="27"
            viewBox="0 0 42 27"
            style={{ y: letterY }}
          >
            <rect x="0.5" y="0.5" width="41" height="26" rx="1.5" />
            <path d="M1 1.5 L21 15 L41 1.5" />
            <rect className="slot-letter-stamp" x="31" y="4" width="7" height="8" />
          </motion.svg>
        </span>
        <span className="pull-label">{LABELS[phase]}</span>
      </motion.div>
    </div>
  )
}
