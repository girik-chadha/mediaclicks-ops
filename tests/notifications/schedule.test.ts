import { describe, expect, it } from 'vitest'
import {
  digestAt,
  digestIsDue,
  reminderAt,
  reminderIsDue,
} from '@/lib/notifications/schedule'

const KOLKATA = 'Asia/Kolkata' // UTC+5:30, no DST
const LONDON = 'Europe/London' // GMT/BST

describe('reminders', () => {
  const start = new Date('2026-08-03T09:00:00Z')

  it('fires the lead time before the meeting', () => {
    expect(reminderAt(start, 30).toISOString()).toBe('2026-08-03T08:30:00.000Z')
    expect(reminderAt(start, 15).toISOString()).toBe('2026-08-03T08:45:00.000Z')
  })

  it('is not due before the lead time is reached', () => {
    expect(reminderIsDue(start, 30, new Date('2026-08-03T08:29:00Z'))).toBe(false)
  })

  it('is due at the lead time', () => {
    expect(reminderIsDue(start, 30, new Date('2026-08-03T08:30:00Z'))).toBe(true)
  })

  it('stays due for a late worker', () => {
    // A tick that ran nine minutes behind still sends. Silence is worse than
    // slightly late.
    expect(reminderIsDue(start, 30, new Date('2026-08-03T08:39:00Z'))).toBe(true)
  })

  it('stops being due once the meeting has started', () => {
    // A reminder arriving during the call implies there is still time to get
    // there, which is worse than no reminder at all.
    expect(reminderIsDue(start, 30, new Date('2026-08-03T09:00:00Z'))).toBe(false)
    expect(reminderIsDue(start, 30, new Date('2026-08-03T09:05:00Z'))).toBe(false)
  })

  it('respects a per-person lead time', () => {
    const at0845 = new Date('2026-08-03T08:45:00Z')
    expect(reminderIsDue(start, 15, at0845)).toBe(true)
    expect(reminderIsDue(start, 60, at0845)).toBe(true) // already past its lead
    const at0810 = new Date('2026-08-03T08:10:00Z')
    expect(reminderIsDue(start, 15, at0810)).toBe(false)
    expect(reminderIsDue(start, 60, at0810)).toBe(true)
  })
})

describe('daily digest', () => {
  it('resolves the local time to the right instant', () => {
    // 08:00 in Kolkata is 02:30 UTC — an offset that is not a whole hour,
    // which is exactly where naive arithmetic goes wrong.
    const on = new Date('2026-08-03T12:00:00Z')
    expect(digestAt('08:00', KOLKATA, on).toISOString()).toBe('2026-08-03T02:30:00.000Z')
  })

  it('gives a different instant per zone for the same local time', () => {
    const on = new Date('2026-08-03T12:00:00Z')
    expect(digestAt('08:00', KOLKATA, on).toISOString()).not.toBe(
      digestAt('08:00', LONDON, on).toISOString(),
    )
  })

  it('tracks daylight saving rather than a fixed offset', () => {
    // 08:00 London is 07:00 UTC in summer and 08:00 UTC in winter.
    expect(digestAt('08:00', LONDON, new Date('2026-07-15T12:00:00Z')).toISOString()).toBe(
      '2026-07-15T07:00:00.000Z',
    )
    expect(digestAt('08:00', LONDON, new Date('2026-01-15T12:00:00Z')).toISOString()).toBe(
      '2026-01-15T08:00:00.000Z',
    )
  })

  it('is not due before the digest time', () => {
    expect(digestIsDue('08:00', KOLKATA, new Date('2026-08-03T02:29:00Z'))).toBe(false)
  })

  it('is due at the digest time', () => {
    expect(digestIsDue('08:00', KOLKATA, new Date('2026-08-03T02:30:00Z'))).toBe(true)
  })

  it('still sends inside the grace window', () => {
    // Worker asleep at 08:00 sends at 09:00 rather than skipping the day.
    expect(digestIsDue('08:00', KOLKATA, new Date('2026-08-03T03:30:00Z'))).toBe(true)
  })

  it('gives up once the day is largely gone', () => {
    // A digest for a day that is nearly over is noise, not information.
    expect(digestIsDue('08:00', KOLKATA, new Date('2026-08-03T06:00:00Z'))).toBe(false)
  })

  it('respects a per-person digest time', () => {
    const at0430Utc = new Date('2026-08-03T04:30:00Z') // 10:00 Kolkata
    expect(digestIsDue('10:00', KOLKATA, at0430Utc)).toBe(true)
    expect(digestIsDue('06:00', KOLKATA, at0430Utc)).toBe(false) // grace expired
  })
})
