import { describe, expect, it } from 'vitest'
import {
  addDays,
  durationMinutes,
  formatDuration,
  formatRange,
  fromWallClock,
  minutesIntoDay,
  overlaps,
  relativeToNow,
  startOfDay,
  startOfWeek,
  toWallClock,
  zoneOffsetMs,
} from '@/lib/time'

const DUBAI = 'Asia/Dubai' // UTC+4 year round, no DST
const LONDON = 'Europe/London' // GMT/BST, DST
const HOUR = 3_600_000

describe('zone offsets', () => {
  it('holds Dubai at +4 across the year', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), DUBAI)).toBe(4 * HOUR)
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), DUBAI)).toBe(4 * HOUR)
  })

  it('tracks London across the DST boundary', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), LONDON)).toBe(0)
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), LONDON)).toBe(HOUR)
  })
})

describe('wall clock round trip', () => {
  it('round-trips an ordinary instant', () => {
    const instant = new Date('2026-08-01T09:30:00Z')
    const wall = toWallClock(instant, DUBAI)
    expect(wall).toEqual({ year: 2026, month: 8, day: 1, hour: 13, minute: 30 })
    expect(fromWallClock(wall, DUBAI).toISOString()).toBe(instant.toISOString())
  })

  it('round-trips either side of a spring-forward boundary', () => {
    // London goes 01:00 GMT → 02:00 BST on 2026-03-29.
    const before = { year: 2026, month: 3, day: 29, hour: 0, minute: 30 }
    const after = { year: 2026, month: 3, day: 29, hour: 3, minute: 30 }
    expect(toWallClock(fromWallClock(before, LONDON), LONDON)).toEqual(before)
    expect(toWallClock(fromWallClock(after, LONDON), LONDON)).toEqual(after)
  })

  it('round-trips either side of an autumn fall-back boundary', () => {
    // London goes 02:00 BST → 01:00 GMT on 2026-10-25.
    const before = { year: 2026, month: 10, day: 25, hour: 0, minute: 30 }
    const after = { year: 2026, month: 10, day: 25, hour: 3, minute: 30 }
    expect(toWallClock(fromWallClock(before, LONDON), LONDON)).toEqual(before)
    expect(toWallClock(fromWallClock(after, LONDON), LONDON)).toEqual(after)
  })

  it('resolves a nonexistent spring-forward time forward, not backward', () => {
    // 01:30 does not exist on 2026-03-29 in London.
    const resolved = fromWallClock(
      { year: 2026, month: 3, day: 29, hour: 1, minute: 30 },
      LONDON,
    )
    const wall = toWallClock(resolved, LONDON)
    expect(wall.day).toBe(29)
    // Must not silently land on the previous day or an hour earlier.
    expect(wall.hour).toBeGreaterThanOrEqual(1)
  })
})

describe('day and week boundaries', () => {
  it('starts the day at local midnight, not UTC midnight', () => {
    // 02:00 Dubai on the 2nd is 22:00 UTC on the 1st — a naive UTC
    // truncation would put this in the wrong day.
    const instant = new Date('2026-08-01T22:00:00Z')
    const start = startOfDay(instant, DUBAI)
    expect(toWallClock(start, DUBAI)).toEqual({
      year: 2026,
      month: 8,
      day: 2,
      hour: 0,
      minute: 0,
    })
  })

  it('starts the week on Monday', () => {
    // 2026-08-01 is a Saturday.
    const start = startOfWeek(new Date('2026-08-01T12:00:00Z'), DUBAI)
    const wall = toWallClock(start, DUBAI)
    expect([wall.month, wall.day]).toEqual([7, 27]) // Monday 27 July
    expect(wall.hour).toBe(0)
  })

  it('keeps a Monday on its own Monday', () => {
    const monday = new Date('2026-07-27T06:00:00Z')
    expect(toWallClock(startOfWeek(monday, DUBAI), DUBAI).day).toBe(27)
  })
})

describe('addDays', () => {
  it('preserves wall-clock time across a DST change', () => {
    // The naive `+ 86_400_000` would land on 09:30 here, an hour out.
    const before = fromWallClock(
      { year: 2026, month: 3, day: 28, hour: 10, minute: 30 },
      LONDON,
    )
    const next = addDays(before, 1, LONDON)
    const wall = toWallClock(next, LONDON)
    expect([wall.day, wall.hour, wall.minute]).toEqual([29, 10, 30])
  })

  it('adds a plain day where there is no DST', () => {
    const start = new Date('2026-08-01T05:30:00Z')
    expect(addDays(start, 1, DUBAI).getTime() - start.getTime()).toBe(24 * HOUR)
  })

  it('goes backwards', () => {
    const start = fromWallClock({ year: 2026, month: 8, day: 3, hour: 9, minute: 0 }, DUBAI)
    expect(toWallClock(addDays(start, -3, DUBAI), DUBAI).day).toBe(31)
  })
})

describe('minutesIntoDay', () => {
  it('measures from local midnight', () => {
    // 09:30 UTC is 13:30 in Dubai → 810 minutes.
    expect(minutesIntoDay(new Date('2026-08-01T09:30:00Z'), DUBAI)).toBe(13 * 60 + 30)
  })

  it('is zero at local midnight', () => {
    const midnight = startOfDay(new Date('2026-08-01T09:30:00Z'), DUBAI)
    expect(minutesIntoDay(midnight, DUBAI)).toBe(0)
  })
})

describe('overlaps', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 1, h, m))

  it('detects a genuine overlap', () => {
    expect(overlaps(at(9), at(10), at(9, 30), at(10, 30))).toBe(true)
  })

  it('treats touching endpoints as free', () => {
    // Back-to-back meetings are not a conflict.
    expect(overlaps(at(9), at(10), at(10), at(11))).toBe(false)
  })

  it('detects containment in both directions', () => {
    expect(overlaps(at(9), at(12), at(10), at(11))).toBe(true)
    expect(overlaps(at(10), at(11), at(9), at(12))).toBe(true)
  })

  it('rejects disjoint intervals', () => {
    expect(overlaps(at(9), at(10), at(11), at(12))).toBe(false)
  })
})

describe('formatting', () => {
  it('renders a range in the viewer zone', () => {
    expect(
      formatRange(
        new Date('2026-08-01T05:30:00Z'),
        new Date('2026-08-01T06:30:00Z'),
        DUBAI,
      ),
    ).toBe('09:30–10:30')
  })

  it('renders the same instant differently per zone', () => {
    const start = new Date('2026-08-01T05:30:00Z')
    const end = new Date('2026-08-01T06:30:00Z')
    expect(formatRange(start, end, DUBAI)).toBe('09:30–10:30')
    expect(formatRange(start, end, LONDON)).toBe('06:30–07:30')
  })

  it('formats durations', () => {
    expect(formatDuration(30)).toBe('30m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(durationMinutes(new Date('2026-08-01T09:00:00Z'), new Date('2026-08-01T09:45:00Z'))).toBe(45)
  })

  it('phrases relative time in the spec voice', () => {
    const now = new Date('2026-08-01T09:00:00Z')
    expect(relativeToNow(new Date('2026-08-01T09:12:00Z'), now)).toBe('Starts in 12 minutes')
    expect(relativeToNow(new Date('2026-08-01T09:01:00Z'), now)).toBe('Starts in 1 minute')
    expect(relativeToNow(now, now)).toBe('Starting now')
    expect(relativeToNow(new Date('2026-08-01T08:55:00Z'), now)).toBe('Started 5 minutes ago')
  })
})
