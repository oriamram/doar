import { useEffect, useState } from 'react'

/** The time now, refreshed twice a minute, so that what depends on it (a code's ticket fading) keeps up. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
