import {
  addDays,
  fromWallClock,
  overlaps,
  startOfDay,
  toWallClock,
  zoneOffsetMs,
} from '@/lib/time'
import { WORK_DAYS, WORK_END_MINUTE, WORK_START_MINUTE } from './tools'

/**
 * Free-slot search for §4.6's find_free_slot.
 *
 * Pure: it takes the busy intervals rather than fetching them, so the search
 * itself is testable without a database and the tool executor stays a thin
 * shell around a function that can be reasoned about.
 *
 * Slots are generated in wall-clock terms and converted per-day through
 * fromWallClock, not by adding 86,400,000 ms. A team in a fixed-offset zone
 * would never notice the difference; a team that isn't would find the
 * assistant proposing 09:00 slots that land at 08:00 after a DST change.
 */

export interface Busy {
  readonly startsAt: Date
  readonly endsAt: Date
}

export interface Slot {
  readonly startsAt: Date
  readonly endsAt: Date
}

/** Candidate start times are offered on the half hour. */
const STEP_MINUTES = 30

export function findFreeSlots(params: {
  from: Date
  withinDays: number
  durationMinutes: number
  busy: readonly Busy[]
  zone: string
  /** Cap on results. The model does not need twenty options to pick from. */
  limit?: number
}): Slot[] {
  const { from, withinDays, durationMinutes, busy, zone } = params
  const limit = params.limit ?? 6

  if (durationMinutes <= 0 || withinDays <= 0) return []

  const found: Slot[] = []

  for (let dayOffset = 0; dayOffset < withinDays; dayOffset++) {
    const dayStart = addDays(startOfDay(from, zone), dayOffset, zone)
    if (!isWorkingDay(dayStart, zone)) continue

    const { year, month, day } = toWallClock(dayStart, zone)

    for (
      let minute = WORK_START_MINUTE;
      minute + durationMinutes <= WORK_END_MINUTE;
      minute += STEP_MINUTES
    ) {
      const startsAt = fromWallClock(
        { year, month, day, hour: Math.floor(minute / 60), minute: minute % 60 },
        zone,
      )

      // Never offer a slot in the past. On day 0 most of the working day
      // usually is.
      if (startsAt.getTime() < from.getTime()) continue

      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000)

      const clash = busy.some((b) => overlaps(startsAt, endsAt, b.startsAt, b.endsAt))
      if (clash) continue

      found.push({ startsAt, endsAt })
      if (found.length >= limit) return found
    }
  }

  return found
}

function isWorkingDay(instant: Date, zone: string): boolean {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant, zone))
  return WORK_DAYS.includes(local.getUTCDay())
}
