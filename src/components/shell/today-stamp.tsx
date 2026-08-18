'use client'

import { useNow } from './use-now'
import { useZone } from './zone-context'

/**
 * Today's date in the person's chosen zone (§8).
 *
 * Client-rendered because the server cannot know "now" without causing a
 * hydration mismatch — but the *zone* is known, and this used to leave it to
 * the browser. Near midnight in a zone the browser does not share, that is
 * not a cosmetic difference: the stamp names a different day than the
 * calendar beneath it.
 */
export function TodayStamp() {
  const now = useNow()
  const zone = useZone()
  if (!now) return <span className="font-mono text-data text-slate">&nbsp;</span>

  const label = new Intl.DateTimeFormat('en-GB', {
    ...(zone ? { timeZone: zone } : {}),
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(now)

  return <span className="font-mono text-data text-slate">{label}</span>
}
