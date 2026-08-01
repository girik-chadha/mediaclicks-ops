'use client'

import { providerCode } from '@/lib/meetings/schema'
import {
  addDays,
  formatRange,
  minutesIntoDay,
  sameZonedDay,
  toWallClock,
} from '@/lib/time'
import { useNow } from '@/components/shell/use-now'
import { blockStyle, meetingState } from './encoding'
import type { MeetingDto } from './types'

/** 07:00–20:00, the working day the design's grid shows. */
const FIRST_HOUR = 7
const LAST_HOUR = 20
const ROW_HEIGHT = 56

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i)
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const GRID_HEIGHT = (LAST_HOUR - FIRST_HOUR) * ROW_HEIGHT

function topFor(minutes: number): number {
  return ((minutes - FIRST_HOUR * 60) / 60) * ROW_HEIGHT
}

interface Positioned {
  meeting: MeetingDto
  top: number
  height: number
  column: number
  columns: number
}

/**
 * Lays out one day's meetings, splitting the column between overlaps (§6.2).
 *
 * Greedy interval colouring: meetings are walked in start order and dropped
 * into the first lane whose last occupant has finished. Every meeting in a
 * mutually-overlapping cluster then shares that cluster's width, so two
 * concurrent calls read as two half-width blocks rather than one hiding the
 * other.
 */
function layout(dayMeetings: MeetingDto[], zone: string): Positioned[] {
  const sorted = [...dayMeetings].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )

  const laneEnds: number[] = []
  const lanes: number[] = []

  for (const m of sorted) {
    const start = new Date(m.startsAt).getTime()
    let lane = laneEnds.findIndex((end) => end <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = new Date(m.endsAt).getTime()
    lanes.push(lane)
  }

  // Cluster width: how many lanes are occupied by anything this meeting
  // actually overlaps, so an isolated meeting later in the day stays full
  // width even if two calls collided that morning.
  return sorted.map((m, i) => {
    const start = new Date(m.startsAt).getTime()
    const end = new Date(m.endsAt).getTime()

    let columns = 1
    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue
      const other = sorted[j]!
      const oStart = new Date(other.startsAt).getTime()
      const oEnd = new Date(other.endsAt).getTime()
      if (start < oEnd && oStart < end) columns = Math.max(columns, lanes[j]! + 1)
    }
    columns = Math.max(columns, lanes[i]! + 1)

    const startMinutes = minutesIntoDay(new Date(m.startsAt), zone)
    const endMinutes = minutesIntoDay(new Date(m.endsAt), zone)

    return {
      meeting: m,
      top: topFor(startMinutes),
      height: Math.max(18, topFor(endMinutes) - topFor(startMinutes)),
      column: lanes[i]!,
      columns,
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
  const weekStart = new Date(weekStartIso)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i, zone))

  return (
    <div className="min-w-[900px]">
      {/* Day headers */}
      <div className="sticky top-0 z-10 flex border-b border-rule bg-surface">
        <div className="w-14 shrink-0 border-r border-rule" />
        {days.map((day, i) => {
          const wall = toWallClock(day, zone)
          const isToday = now ? sameZonedDay(day, now, zone) : false
          return (
            <div key={i} className="flex-1 border-r border-rule px-2 py-2 last:border-r-0">
              <div className="text-micro uppercase text-slate">{DAY_NAMES[i]}</div>
              <div
                className={`font-mono text-data tabular-nums ${isToday ? 'text-live' : 'text-ink'}`}
              >
                {String(wall.day).padStart(2, '0')}
              </div>
            </div>
          )
        })}
      </div>

      {/* Grid body */}
      <div className="relative flex">
        {/* Hour gutter */}
        <div className="w-14 shrink-0 border-r border-rule">
          {HOURS.slice(0, -1).map((h) => (
            <div key={h} className="relative" style={{ height: ROW_HEIGHT }}>
              <span className="absolute -top-1.5 right-2 font-mono text-[9px] tracking-[-0.02em] text-slate">
                {String(h).padStart(2, '0')}:00
              </span>
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
              className="relative flex-1 border-r border-rule last:border-r-0"
              style={{ height: GRID_HEIGHT }}
            >
              {/* Hour lines */}
              {HOURS.slice(1, -1).map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 h-px bg-rule"
                  style={{ top: topFor(h * 60) }}
                />
              ))}

              {/* The playhead runs across today's column only (§6.2). */}
              {isToday && now && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 h-px bg-live"
                  style={{ top: topFor(minutesIntoDay(now, zone)) }}
                >
                  <div className="absolute -left-0.5 -top-[1.5px] size-1 rounded-full bg-live" />
                </div>
              )}

              {positioned.map(({ meeting, top, height, column, columns }) => {
                const state = meetingState(meeting, now ?? new Date(meeting.startsAt))
                const style = blockStyle(meeting, state)
                const width = 100 / columns

                return (
                  <button
                    key={meeting.id}
                    type="button"
                    onClick={() => onOpen(meeting.id)}
                    className="absolute overflow-hidden rounded-sm px-1.5 py-1 text-left transition-colors duration-[80ms]"
                    style={{
                      top,
                      height,
                      left: `${column * width}%`,
                      width: `calc(${width}% - 2px)`,
                      background: style.background,
                      border: style.border,
                      borderLeft: style.borderLeft,
                      opacity: style.opacity,
                    }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        {/* Client name above the title; team meetings show
                            nothing here — the absence is the signal (§5). */}
                        {meeting.clientName && (
                          <div className="truncate text-micro uppercase text-slate">
                            {meeting.clientName}
                          </div>
                        )}
                        <div
                          className="truncate text-label"
                          style={{ textDecoration: style.textDecoration }}
                        >
                          {meeting.title}
                        </div>
                      </div>
                      {/* Platform is monochrome, never brand colour (§5). */}
                      <span className="shrink-0 font-mono text-[9px] tracking-[-0.02em] text-slate">
                        {providerCode(meeting.conferencingProvider)}
                      </span>
                    </div>
                    {height > 34 && (
                      <div className="mt-0.5 font-mono text-[9px] tabular-nums text-slate">
                        {formatRange(new Date(meeting.startsAt), new Date(meeting.endsAt), zone)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
