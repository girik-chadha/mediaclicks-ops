import { describe, expect, it } from 'vitest'
import { findFreeSlots } from '@/lib/assistant/free-slots'
import { formatRange } from '@/lib/time'

const KOLKATA = 'Asia/Kolkata' // UTC+5:30 — the team's zone, and a half-hour offset
const LONDON = 'Europe/London'

// Monday 2026-08-03, 00:00 IST.
const MONDAY = new Date('2026-08-02T18:30:00Z')

describe('finding a free slot', () => {
  it('offers times inside working hours only', () => {
    const slots = findFreeSlots({
      from: MONDAY,
      withinDays: 1,
      durationMinutes: 60,
      busy: [],
      zone: KOLKATA,
      limit: 20,
    })

    expect(slots.length).toBeGreaterThan(0)
    for (const s of slots) {
      const start = formatRange(s.startsAt, s.endsAt, KOLKATA)
      expect(start).not.toMatch(/^0[0-8]:/)
    }
    // 09:00 first, 17:00–18:00 last: the window is [09:00, 18:00).
    expect(slots[0]!.startsAt.toISOString()).toBe('2026-08-03T03:30:00.000Z') // 09:00 IST
    expect(slots.at(-1)!.endsAt.toISOString()).toBe('2026-08-03T12:30:00.000Z') // 18:00 IST
  })

  it('skips a slot that collides with a meeting', () => {
    const slots = findFreeSlots({
      from: MONDAY,
      withinDays: 1,
      durationMinutes: 60,
      busy: [
        {
          startsAt: new Date('2026-08-03T03:30:00Z'), // 09:00 IST
          endsAt: new Date('2026-08-03T04:30:00Z'), // 10:00 IST
        },
      ],
      zone: KOLKATA,
      limit: 2,
    })

    // 09:00 is taken and 09:30 still overlaps it, so 10:00 is the first offer.
    expect(slots[0]!.startsAt.toISOString()).toBe('2026-08-03T04:30:00.000Z')
  })

  it('treats a meeting that ends when the slot begins as free', () => {
    const slots = findFreeSlots({
      from: MONDAY,
      withinDays: 1,
      durationMinutes: 30,
      busy: [
        {
          startsAt: new Date('2026-08-03T02:30:00Z'),
          endsAt: new Date('2026-08-03T03:30:00Z'), // ends exactly at 09:00 IST
        },
      ],
      zone: KOLKATA,
      limit: 1,
    })

    expect(slots[0]!.startsAt.toISOString()).toBe('2026-08-03T03:30:00.000Z')
  })

  it('does not offer the weekend', () => {
    // Saturday 2026-08-08 through Sunday: two days, nothing on offer.
    const saturday = new Date('2026-08-07T18:30:00Z')
    const slots = findFreeSlots({
      from: saturday,
      withinDays: 2,
      durationMinutes: 60,
      busy: [],
      zone: KOLKATA,
      limit: 20,
    })
    expect(slots).toEqual([])
  })

  it('never offers a time that has already passed', () => {
    // 12:40 Monday: the morning is gone, and so is the 12:30 slot that
    // started ten minutes ago.
    const now = new Date('2026-08-03T07:10:00Z') // 12:40 IST
    const slots = findFreeSlots({
      from: now,
      withinDays: 1,
      durationMinutes: 60,
      busy: [],
      zone: KOLKATA,
      limit: 1,
    })
    expect(slots[0]!.startsAt.getTime()).toBeGreaterThanOrEqual(now.getTime())
    expect(slots[0]!.startsAt.toISOString()).toBe('2026-08-03T07:30:00.000Z') // 13:00 IST
  })

  it('holds the local hour across a daylight-saving change', () => {
    // Britain leaves BST on 2026-10-25. Friday the 23rd is BST (09:00 =
    // 08:00Z); Monday the 26th is GMT (09:00 = 09:00Z). Adding 24h in
    // milliseconds would put the Monday slot at 08:00 local.
    const friday = new Date('2026-10-22T23:00:00Z') // Fri 23rd 00:00 BST
    const slots = findFreeSlots({
      from: friday,
      withinDays: 4,
      durationMinutes: 60,
      busy: [],
      zone: LONDON,
      limit: 100,
    })

    const first = slots[0]!
    const monday = slots.find((s) => s.startsAt > new Date('2026-10-26T00:00:00Z'))!

    expect(first.startsAt.toISOString()).toBe('2026-10-23T08:00:00.000Z')
    expect(monday.startsAt.toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(formatRange(first.startsAt, first.endsAt, LONDON)).toBe(
      formatRange(monday.startsAt, monday.endsAt, LONDON),
    )
  })

  it('returns nothing rather than something wrong for a nonsense request', () => {
    const base = { from: MONDAY, busy: [], zone: KOLKATA }
    expect(findFreeSlots({ ...base, withinDays: 1, durationMinutes: 0 })).toEqual([])
    expect(findFreeSlots({ ...base, withinDays: 0, durationMinutes: 60 })).toEqual([])
    // Longer than the working day fits nowhere.
    expect(findFreeSlots({ ...base, withinDays: 5, durationMinutes: 10 * 60 })).toEqual([])
  })
})
