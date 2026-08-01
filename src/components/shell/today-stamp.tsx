'use client'

import { useNow } from './use-now'

/**
 * Today's date in the viewer's own zone (§8). Client-rendered because the
 * server does not know which zone that is, and guessing would produce a
 * hydration mismatch on the one element whose whole job is being correct
 * about time.
 */
export function TodayStamp() {
  const now = useNow()
  if (!now) return <span className="font-mono text-data text-slate">&nbsp;</span>

  const label = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(now)

  return <span className="font-mono text-data text-slate">{label}</span>
}
