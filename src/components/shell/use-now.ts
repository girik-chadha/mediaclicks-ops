'use client'

import { useEffect, useState } from 'react'
import { toWallClock } from '@/lib/time'

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

/**
 * The wall clock these three read.
 *
 * `zone` is the person's chosen zone, or null on a screen with no signed-in
 * actor. Null means the browser's, which is the only zone available there.
 * Everywhere else the stored zone wins — the whole app treats it as
 * authoritative (see src/lib/time.ts), and the shell used to be the one
 * place that quietly did not.
 */
function reading(now: Date, zone: string | null): { hour: number; minute: number } {
  if (!zone) return { hour: now.getHours(), minute: now.getMinutes() }
  const { hour, minute } = toWallClock(now, zone)
  return { hour, minute }
}

/** Fraction of the day elapsed, 0–100. Drives the playhead's position. */
export function dayFraction(now: Date, zone: string | null = null): number {
  const { hour, minute } = reading(now, zone)
  return ((hour * 60 + minute) / 1440) * 100
}

export function formatClock(now: Date, zone: string | null = null): string {
  const { hour, minute } = reading(now, zone)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** The zone, abbreviated — §8: never make someone do the maths. */
export function timezoneLabel(now: Date, zone: string | null = null): string {
  const part = new Intl.DateTimeFormat('en-GB', {
    ...(zone ? { timeZone: zone } : {}),
    timeZoneName: 'short',
  })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? 'LOCAL'
}
