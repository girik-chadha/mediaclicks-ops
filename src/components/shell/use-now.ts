'use client'

import { useEffect, useState } from 'react'

/**
 * The current time, re-rendering once per minute on the minute boundary.
 *
 * Returns null until mounted. The server and the browser cannot agree on
 * "now", so rendering a clock during SSR guarantees a hydration mismatch;
 * the Rail draws its scale immediately and fills in the live parts after.
 *
 * Aligned with setTimeout rather than a 1s setInterval: the clock is
 * minute-resolution (brief §4) and the playhead moves 0.069% of the rail per
 * minute, so a per-second interval would be ~60x the renders for a
 * sub-pixel difference, for the lifetime of every page.
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    }

    tick()
    return () => clearTimeout(timer)
  }, [])

  return now
}

/** Fraction of the day elapsed, 0–100. Drives the playhead's position. */
export function dayFraction(now: Date): number {
  return ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100
}

export function formatClock(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** The viewer's own zone, abbreviated — §8: never make someone do the maths. */
export function timezoneLabel(now: Date): string {
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? 'LOCAL'
}
