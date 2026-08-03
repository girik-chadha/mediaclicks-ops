import { describe, expect, it } from 'vitest'
import { formatRange, formatTime } from '@/lib/time'
import { resolveDay, resolveRange, resolveWhen } from '@/lib/assistant/when'

const KOLKATA = 'Asia/Kolkata'
const LONDON = 'Europe/London'

/** Monday 3 August 2026, 11:00 IST. */
const MONDAY = new Date('2026-08-03T05:30:00Z')

/**
 * "Mon 03 Aug", punctuation removed.
 *
 * Intl's separators differ between ICU builds — the same call renders
 * "Mon, 03 Aug" on one Node and "Mon 03 Aug" on another. Asserting on the
 * raw output would make these tests fail on a CI image for a reason that
 * has nothing to do with the dates being right.
 */
const localDate = (d: Date, zone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: zone,
  })
    .format(d)
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')

describe('resolving a day', () => {
  it('reads today and tomorrow in the actor’s zone', () => {
    expect(localDate(resolveDay({ kind: 'today' }, MONDAY, KOLKATA), KOLKATA)).toBe('Mon 03 Aug')
    expect(localDate(resolveDay({ kind: 'tomorrow' }, MONDAY, KOLKATA), KOLKATA)).toBe(
      'Tue 04 Aug',
    )
  })

  it('reads a weekday as the next one ahead', () => {
    const thursday = resolveDay({ kind: 'weekday', weekday: 4, next: false }, MONDAY, KOLKATA)
    expect(localDate(thursday, KOLKATA)).toBe('Thu 06 Aug')
  })

  it('never resolves a weekday to today', () => {
    // Said on a Monday, "Monday" means the one coming, not the one you are
    // standing in. Resolving to today would silently schedule things into
    // the past for most of the working day.
    const monday = resolveDay({ kind: 'weekday', weekday: 1, next: false }, MONDAY, KOLKATA)
    expect(localDate(monday, KOLKATA)).toBe('Mon 10 Aug')
  })

  it('reads "next <weekday>" as the following week', () => {
    // Genuinely ambiguous in English. This is the reading, and it is pinned
    // so it cannot drift: next week's Thursday, not this week's.
    const next = resolveDay({ kind: 'weekday', weekday: 4, next: true }, MONDAY, KOLKATA)
    expect(localDate(next, KOLKATA)).toBe('Thu 13 Aug')
  })

  it('does not double-skip when the plain reading is already next week', () => {
    // Said on a Friday, "next Monday" is three days away, and "Monday of
    // next week" is the same day — it must not jump to the week after.
    const friday = new Date('2026-08-07T05:30:00Z')
    const next = resolveDay({ kind: 'weekday', weekday: 1, next: true }, friday, KOLKATA)
    expect(localDate(next, KOLKATA)).toBe('Mon 10 Aug')
  })
})

describe('resolving a range', () => {
  it('covers exactly one day for today and tomorrow', () => {
    const today = resolveRange('today', MONDAY, KOLKATA)
    expect(localDate(today.from, KOLKATA)).toBe('Mon 03 Aug')
    expect(today.to.getTime() - today.from.getTime()).toBe(86_400_000)

    const tomorrow = resolveRange('tomorrow', MONDAY, KOLKATA)
    expect(localDate(tomorrow.from, KOLKATA)).toBe('Tue 04 Aug')
  })

  it('starts weeks on Monday', () => {
    const week = resolveRange('this-week', MONDAY, KOLKATA)
    expect(localDate(week.from, KOLKATA)).toBe('Mon 03 Aug')
    expect(localDate(week.to, KOLKATA)).toBe('Mon 10 Aug')
  })

  it('reads next week from a Sunday as the week that starts tomorrow', () => {
    // Sunday is the awkward day: it belongs to the week that is ending, so
    // "next week" must not skip a week.
    const sunday = new Date('2026-08-09T05:30:00Z')
    const week = resolveRange('next-week', sunday, KOLKATA)
    expect(localDate(week.from, KOLKATA)).toBe('Mon 10 Aug')
  })
})

describe('resolving a move', () => {
  /** A meeting on Monday at 14:00 IST. */
  const meeting = new Date('2026-08-03T08:30:00Z')

  it('keeps the time when only a day is named', () => {
    const moved = resolveWhen(
      { day: { kind: 'weekday', weekday: 4, next: false }, time: null },
      meeting,
      MONDAY,
      KOLKATA,
    )
    expect(localDate(moved, KOLKATA)).toBe('Thu 06 Aug')
    expect(formatTime(moved, KOLKATA)).toBe(formatTime(meeting, KOLKATA))
  })

  it('keeps the day when only a time is named', () => {
    const moved = resolveWhen({ day: null, time: { hour: 16, minute: 30 } }, meeting, MONDAY, KOLKATA)
    expect(localDate(moved, KOLKATA)).toBe('Mon 03 Aug')
    expect(formatTime(moved, KOLKATA)).toBe('16:30')
  })

  it('takes both when both are named', () => {
    const moved = resolveWhen(
      { day: { kind: 'tomorrow' }, time: { hour: 9, minute: 0 } },
      meeting,
      MONDAY,
      KOLKATA,
    )
    expect(localDate(moved, KOLKATA)).toBe('Tue 04 Aug')
    expect(formatTime(moved, KOLKATA)).toBe('09:00')
  })

  it('lands on the stated wall-clock time across a DST change', () => {
    // A London meeting on Friday 23 Oct (BST) moved to Monday 26 Oct (GMT).
    // Arithmetic in milliseconds would land it an hour early.
    const friday = new Date('2026-10-23T13:00:00Z') // 14:00 BST
    const now = new Date('2026-10-22T09:00:00Z')
    const moved = resolveWhen(
      { day: { kind: 'weekday', weekday: 1, next: false }, time: null },
      friday,
      now,
      LONDON,
    )
    expect(localDate(moved, LONDON)).toBe('Mon 26 Oct')
    expect(formatTime(moved, LONDON)).toBe('14:00')
    expect(moved.toISOString()).toBe('2026-10-26T14:00:00.000Z') // GMT, so +0
  })

  it('holds a half-hour offset zone', () => {
    // Kolkata is UTC+5:30. A whole-hour assumption anywhere in the chain
    // shows up here and nowhere else.
    const moved = resolveWhen(
      { day: { kind: 'tomorrow' }, time: { hour: 9, minute: 0 } },
      meeting,
      MONDAY,
      KOLKATA,
    )
    expect(moved.toISOString()).toBe('2026-08-04T03:30:00.000Z')
  })

  it('preserves the meeting’s length when the caller derives the end', () => {
    const start = new Date('2026-08-03T08:30:00Z')
    const end = new Date('2026-08-03T09:30:00Z')
    const movedStart = resolveWhen(
      { day: { kind: 'tomorrow' }, time: null },
      start,
      MONDAY,
      KOLKATA,
    )
    const movedEnd = new Date(movedStart.getTime() + (end.getTime() - start.getTime()))
    expect(formatRange(movedStart, movedEnd, KOLKATA)).toBe(formatRange(start, end, KOLKATA))
  })
})
