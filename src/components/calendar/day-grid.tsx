'use client'

import { useState } from 'react'
import { providerCode } from '@/lib/meetings/schema'
import { addDays, formatRange, minutesIntoDay, sameZonedDay, toWallClock } from '@/lib/time'
import { useNow } from '@/components/shell/use-now'
import { blockStyle, isTimeCritical, meetingState } from './encoding'
import type { MeetingDto } from './types'

/**
 * The mobile calendar: one day, scrolled vertically.
 *
 * Brief §9 is blunt about this — "the week grid does not survive that width
 * and shouldn't try." Seven columns at 390px gives roughly 47px each, which
 * is narrower than the time label inside them. So this is a different view,
 * not a squeezed one: full-width blocks, a day stepper instead of a week
 * stepper, and the same encoding rules so it still reads as the same product.
 */

const FIRST_HOUR = 7
const LAST_HOUR = 20
const ROW = 56
const GUTTER = 52

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i)
const GRID_HEIGHT = HOURS.length * ROW
const topFor = (minutes: number) => ((minutes - FIRST_HOUR * 60) / 60) * ROW

export function DayGrid({
  meetings,
  weekStartIso,
  zone,
  onOpen,
}: {
  meetings: MeetingDto[]
  weekStartIso: string
  zone: string
  onOpen: (id: string) => void
}) {
  const now = useNow()
  const weekStart = new Date(weekStartIso)

  // Open on today when today is in this week, otherwise on the Monday.
  const todayIndex = now
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i, zone)).findIndex((d) =>
        sameZonedDay(d, now, zone),
      )
    : -1
  const [dayIndex, setDayIndex] = useState(todayIndex >= 0 ? todayIndex : 0)

  const day = addDays(weekStart, dayIndex, zone)
  const wall = toWallClock(day, zone)
  const isToday = now ? sameZonedDay(day, now, zone) : false

  const dayMeetings = meetings
    .filter((m) => sameZonedDay(new Date(m.startsAt), day, zone))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())

  const label = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    timeZone: zone,
  }).format(day)

  return (
    <div className="bg-surface">
      <div className="sticky top-0 z-[2] flex items-center justify-between border-b border-rule bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
          disabled={dayIndex === 0}
          aria-label="Previous day"
          className="flex size-8 items-center justify-center rounded-sm text-slate transition-colors duration-[80ms] hover:bg-rule disabled:opacity-30"
        >
          ←
        </button>

        <div className="text-center">
          <div
            className="text-label font-medium"
            style={{ color: isToday ? 'var(--live)' : 'var(--ink)' }}
          >
            {label}
          </div>
          <div className="text-micro uppercase text-slate">
            {dayMeetings.length === 0
              ? 'Nothing scheduled'
              : `${dayMeetings.length} ${dayMeetings.length === 1 ? 'meeting' : 'meetings'}`}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDayIndex((i) => Math.min(6, i + 1))}
          disabled={dayIndex === 6}
          aria-label="Next day"
          className="flex size-8 items-center justify-center rounded-sm text-slate transition-colors duration-[80ms] hover:bg-rule disabled:opacity-30"
        >
          →
        </button>
      </div>

      {dayMeetings.length === 0 ? (
        <p className="px-4 py-16 text-center text-body text-slate">
          Nothing scheduled on {String(wall.day).padStart(2, '0')}.
        </p>
      ) : (
        <div className="relative flex">
          <div className="shrink-0 border-r border-rule" style={{ width: GUTTER }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="border-t border-rule px-2 py-1 text-right font-mono text-[0.625rem] tracking-[-0.02em] text-slate"
                style={{ height: ROW }}
              >
                {String(h).padStart(2, '0')}
              </div>
            ))}
          </div>

          <div className="relative min-w-0 flex-1" style={{ height: GRID_HEIGHT }}>
            {HOURS.map((h) => (
              <div key={h} className="border-t border-rule" style={{ height: ROW }} />
            ))}

            {dayMeetings.map((m) => {
              const state = meetingState(m, now ?? new Date(m.startsAt))
              const style = blockStyle(m, state)
              const start = minutesIntoDay(new Date(m.startsAt), zone)
              const end = minutesIntoDay(new Date(m.endsAt), zone)
              // Clamped, and collapsed to one line when short — see the same
              // pair of fixes in week-grid.tsx for why.
              const top = Math.max(0, topFor(start))
              const height = Math.max(26, Math.min(GRID_HEIGHT, topFor(end)) - top)
              const compact = height < 44

              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpen(m.id)}
                  // Full width — at this size, splitting overlaps would make
                  // both unreadable. They stack and the later one wins the tap.
                  className="absolute inset-x-1 overflow-hidden rounded-sm text-left"
                  style={{
                    top,
                    height,
                    padding: '5px 8px',
                    background: style.background,
                    border: style.border,
                    borderLeft: style.borderLeft,
                    opacity: style.opacity,
                  }}
                >
                  {compact ? (
                    <div className="flex items-baseline gap-2">
                      <span
                        className="min-w-0 flex-1 truncate text-label leading-[1.2]"
                        style={{ textDecoration: style.textDecoration }}
                      >
                        {m.clientName ? `${m.clientName} — ` : ''}
                        {m.title}
                      </span>
                      <span className="shrink-0 font-mono text-[0.5625rem] tracking-[-0.02em] text-slate">
                        {providerCode(m.conferencingProvider)}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className="font-mono text-[0.6875rem] tracking-[-0.02em] tabular-nums"
                          style={{ color: isTimeCritical(state) ? 'var(--live)' : 'var(--slate)' }}
                        >
                          {formatRange(new Date(m.startsAt), new Date(m.endsAt), zone)}
                        </span>
                        <span className="shrink-0 font-mono text-[0.5625rem] tracking-[-0.02em] text-slate">
                          {providerCode(m.conferencingProvider)}
                        </span>
                      </div>
                      {m.clientName && (
                        <div className="truncate text-micro uppercase text-slate">
                          {m.clientName}
                        </div>
                      )}
                      <div
                        className="truncate text-label"
                        style={{ textDecoration: style.textDecoration }}
                      >
                        {m.title}
                      </div>
                    </>
                  )}
                </button>
              )
            })}

            {isToday && now && (
              <div
                className="pointer-events-none absolute inset-x-0 z-[3] h-px bg-live"
                style={{ top: topFor(minutesIntoDay(now, zone)) }}
              >
                <div className="absolute left-0 -top-[2.5px] size-1.5 rounded-full bg-live" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
