'use client'

import { LogoMark } from './logo'
import { dayFraction, formatClock, timezoneLabel, useNow } from './use-now'

/**
 * The Rail — the product's spine (brief §4).
 *
 * A compressed 24-hour scale for today, present on every screen including
 * login. The live playhead is the one risk the brief asks for: it makes
 * lateness feel physical, which is justified because the entire product
 * exists so people do not miss things.
 *
 * Phase 1 draws the empty scale and the clock. The brief calls that out
 * explicitly — with nothing scheduled it "is honest and still feels alive."
 * Meeting marks arrive with the calendar in Phase 2.
 */

/** Hour labels every three hours, matching the design's rail. */
const HOURS = Array.from({ length: 9 }, (_, i) => {
  const hour = i * 3
  return { hour, top: (hour / 24) * 100, label: hour === 24 ? '24' : String(hour).padStart(2, '0') }
})

function Playhead({ percent, orientation }: { percent: number; orientation: 'vertical' | 'horizontal' }) {
  // Position is set inline with no transition, so it keeps updating under
  // prefers-reduced-motion while every other animation is suppressed
  // (brief §7).
  return orientation === 'vertical' ? (
    <div className="absolute inset-x-0 h-px bg-live" style={{ top: `${percent}%` }}>
      <div className="absolute left-0 -top-[1.5px] size-1 rounded-full bg-live" />
    </div>
  ) : (
    <div className="absolute inset-y-0 w-px bg-live" style={{ left: `${percent}%` }}>
      <div className="absolute top-0 -left-[1.5px] size-1 rounded-full bg-live" />
    </div>
  )
}

export function Rail({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const now = useNow()

  if (orientation === 'horizontal') {
    return (
      <div className="flex h-11 w-full items-center gap-3 border-b border-rule bg-surface px-3">
        <div className="relative h-6 flex-1">
          {HOURS.map(({ hour, top, label }) => (
            <div key={hour} className="absolute inset-y-0 flex flex-col justify-end" style={{ left: `${top}%` }}>
              <div className="h-1.5 w-px bg-rule" />
              <div className="font-mono text-[9px] leading-none tracking-[-0.02em] text-slate">
                {label}
              </div>
            </div>
          ))}
          {now && <Playhead percent={dayFraction(now)} orientation="horizontal" />}
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-mono text-[0.6875rem] font-medium leading-none tracking-[-0.06em] tabular-nums text-live">
            {now ? formatClock(now) : '  :  '}
          </span>
          <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.08em] text-slate">
            {now ? timezoneLabel(now) : ''}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative z-10 flex w-14 shrink-0 flex-col border-r border-rule bg-surface">
      <div className="flex h-12 items-center justify-center border-b border-rule text-ink">
        <LogoMark size={20} />
      </div>

      <div className="relative flex-1 py-2">
        <div className="absolute inset-x-0 top-2 bottom-2">
          {HOURS.map(({ hour, top, label }) => (
            <div
              key={hour}
              className="absolute inset-x-0 flex items-center gap-1"
              style={{ top: `${top}%` }}
            >
              <div className="h-px w-2 bg-rule" />
              <div className="font-mono text-[9px] leading-none tracking-[-0.02em] text-slate">
                {label}
              </div>
            </div>
          ))}

          {now && <Playhead percent={dayFraction(now)} orientation="vertical" />}
        </div>
      </div>

      <div className="border-t border-rule py-2.5 text-center">
        <div className="font-mono text-[0.6875rem] font-medium leading-[1.1] tracking-[-0.06em] tabular-nums text-live">
          {/* Non-breaking spaces hold the line's height before mount. */}
          {now ? formatClock(now) : '  :  '}
        </div>
        <div className="mt-1 text-[0.5625rem] font-semibold uppercase tracking-[0.08em] text-slate">
          {now ? timezoneLabel(now) : ' '}
        </div>
      </div>
    </div>
  )
}
