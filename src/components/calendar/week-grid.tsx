'use client'

import { useState } from 'react'
import { providerCode } from '@/lib/meetings/schema'
import { addDays, formatRange, minutesIntoDay, sameZonedDay, toWallClock } from '@/lib/time'
import { useNow } from '@/components/shell/use-now'
import { blockStyle, isTimeCritical, meetingState } from './encoding'
import type { MeetingDto } from './types'

/** 07:00–20:00 in 56px rows, with a 64px hour gutter — the design's grid. */
const FIRST_HOUR = 7
const LAST_HOUR = 20
const ROW = 56
const GUTTER = 64

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i)
const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const GRID_HEIGHT = HOURS.length * ROW

const topFor = (minutes: number) => ((minutes - FIRST_HOUR * 60) / 60) * ROW

interface Positioned {
  meeting: MeetingDto
  top: number
  height: number
  left: number
  width: number
}

/**
 * Lays out a day, splitting the column between overlaps (brief §6.2).
 *
 * Greedy interval colouring: meetings are walked in start order and dropped
 * into the first lane whose occupant has finished. Width is then decided per
 * cluster, so an isolated afternoon meeting stays full width even if two
 * calls collided that morning.
 */
function layout(dayMeetings: MeetingDto[], zone: string): Positioned[] {
  const sorted = [...dayMeetings].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )

  const laneEnd: number[] = []
  const lane: number[] = []

  for (const m of sorted) {
    const start = new Date(m.startsAt).getTime()
    let i = laneEnd.findIndex((end) => end <= start)
    if (i === -1) {
      i = laneEnd.length
      laneEnd.push(0)
    }
    laneEnd[i] = new Date(m.endsAt).getTime()
    lane.push(i)
  }

  return sorted.map((m, i) => {
    const start = new Date(m.startsAt).getTime()
    const end = new Date(m.endsAt).getTime()

    let columns = lane[i]! + 1
    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue
      const other = sorted[j]!
      if (start < new Date(other.endsAt).getTime() && new Date(other.startsAt).getTime() < end) {
        columns = Math.max(columns, lane[j]! + 1)
      }
    }

    const width = 100 / columns
    return {
      meeting: m,
      top: topFor(minutesIntoDay(new Date(m.startsAt), zone)),
      height: Math.max(22, topFor(minutesIntoDay(new Date(m.endsAt), zone)) - topFor(minutesIntoDay(new Date(m.startsAt), zone))),
      left: lane[i]! * width,
      width,
    }
  })
}

export function WeekGrid({
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
  const [hovered, setHovered] = useState<string | null>(null)
  const weekStart = new Date(weekStartIso)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i, zone))

  return (
    <div className="min-w-[820px] bg-surface">
      {/* Day headers */}
      <div className="sticky top-0 z-[2] flex border-b border-rule bg-surface">
        <div className="shrink-0 border-r border-rule" style={{ width: GUTTER }} />
        {days.map((day, i) => {
          const wall = toWallClock(day, zone)
          const isToday = now ? sameZonedDay(day, now, zone) : false
          return (
            <div key={i} className="min-w-0 flex-1 border-r border-rule px-3 py-2">
              <div
                className="text-micro uppercase"
                style={{ color: isToday ? 'var(--ink)' : 'var(--slate)' }}
              >
                {DAY_NAMES[i]}
              </div>
              <div
                className="mt-0.5 font-mono text-data tabular-nums"
                style={{ color: isToday ? 'var(--live)' : 'var(--slate)' }}
              >
                {String(wall.day).padStart(2, '0')}
              </div>
            </div>
          )
        })}
      </div>

      <div className="relative flex min-w-[820px]">
        {/* Hour gutter — label at the top of each row, right aligned */}
        <div className="shrink-0 border-r border-rule" style={{ width: GUTTER }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="border-t border-rule px-2 py-1 text-right font-mono text-[0.6875rem] tracking-[-0.02em] text-slate"
              style={{ height: ROW }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {days.map((day, dayIndex) => {
          const dayMeetings = meetings.filter((m) =>
            sameZonedDay(new Date(m.startsAt), day, zone),
          )
          const positioned = layout(dayMeetings, zone)
          const isToday = now ? sameZonedDay(day, now, zone) : false

          return (
            <div
              key={dayIndex}
              className="relative min-w-0 flex-1 border-r border-rule"
              style={{ height: GRID_HEIGHT }}
            >
              {HOURS.map((h) => (
                <div key={h} className="border-t border-rule" style={{ height: ROW }} />
              ))}

              {positioned.map(({ meeting, top, height, left, width }) => {
                const state = meetingState(meeting, now ?? new Date(meeting.startsAt))
                const style = blockStyle(meeting, state)
                const isHovered = hovered === meeting.id

                return (
                  <button
                    key={meeting.id}
                    type="button"
                    onClick={() => onOpen(meeting.id)}
                    onMouseEnter={() => setHovered(meeting.id)}
                    onMouseLeave={() => setHovered(null)}
                    className="absolute overflow-hidden rounded-sm text-left"
                    style={{
                      top,
                      height,
                      left: `${left}%`,
                      width: `calc(${width}% - 2px)`,
                      padding: '5px 6px',
                      background: style.background,
                      border: style.border,
                      borderLeft: style.borderLeft,
                      // Hover thickens the left rule only — no lift, no shadow (§7).
                      borderLeftWidth: isHovered ? 3 : 2,
                      opacity: style.opacity,
                      transition:
                        'background 400ms linear, border-color 400ms linear, border-left-width 80ms linear, opacity 400ms linear',
                    }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span
                        className="font-mono text-[0.6875rem] tracking-[-0.02em] tabular-nums"
                        style={{
                          color: isTimeCritical(state) ? 'var(--live)' : 'var(--slate)',
                        }}
                      >
                        {formatRange(new Date(meeting.startsAt), new Date(meeting.endsAt), zone)}
                      </span>
                      {/* Monochrome, never brand colour (§5). */}
                      <span className="shrink-0 font-mono text-[0.5625rem] tracking-[-0.02em] text-slate">
                        {providerCode(meeting.conferencingProvider)}
                      </span>
                    </div>

                    {/* Client name above the title. Team meetings show nothing
                        here — the absence is the signal (§5). */}
                    {meeting.clientName && (
                      <div className="mt-0.5 truncate text-micro uppercase text-slate">
                        {meeting.clientName}
                      </div>
                    )}

                    <div
                      className="mt-px truncate text-label leading-[1.3]"
                      style={{ textDecoration: style.textDecoration }}
                    >
                      {meeting.title}
                    </div>
                  </button>
                )
              })}

              {/* The playhead crosses today's column only (§6.2). */}
              {isToday && now && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-[3] h-px bg-live"
                  style={{ top: topFor(minutesIntoDay(now, zone)) }}
                >
                  <div className="absolute left-0 -top-[2.5px] size-1.5 rounded-full bg-live" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
