import { describe, expect, it } from 'vitest'
import {
  REMEMBERED_MS,
  UNREMEMBERED_MS,
  expiryFor,
  sessionExpired,
  sessionWindowMs,
} from '@/lib/auth/session-window'

/**
 * The whole behaviour of "keep me signed in on this device".
 *
 * Worth pinning precisely, because the bug this feature can have is silent:
 * a checkbox that appears to work while every session quietly lasts a month.
 * Nothing here needs a browser or a database, so there is no excuse for it
 * not being covered.
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('session windows', () => {
  it('gives a remembered device 30 days and everyone else 12 hours', () => {
    expect(sessionWindowMs(true)).toBe(30 * DAY)
    expect(sessionWindowMs(false)).toBe(12 * HOUR)
  })

  it('makes the unremembered window genuinely shorter', () => {
    // The point of the feature. If these ever converge, the checkbox is
    // decorative and this test is the only thing that would say so.
    expect(UNREMEMBERED_MS).toBeLessThan(REMEMBERED_MS)
  })

  it('stamps an absolute deadline from the moment of sign-in', () => {
    const now = 1_700_000_000_000
    expect(expiryFor(true, now)).toBe(now + 30 * DAY)
    expect(expiryFor(false, now)).toBe(now + 12 * HOUR)
  })
})

describe('expiry', () => {
  const now = 1_700_000_000_000

  it('is not expired a minute before the deadline', () => {
    expect(sessionExpired(now + 60_000, now)).toBe(false)
  })

  it('is expired at the deadline, not just after it', () => {
    expect(sessionExpired(now, now)).toBe(true)
  })

  it('is expired after the deadline', () => {
    expect(sessionExpired(now - 1, now)).toBe(true)
  })

  it('an unremembered session is dead the next working day', () => {
    const stamped = expiryFor(false, now)
    expect(sessionExpired(stamped, now + 11 * HOUR)).toBe(false)
    expect(sessionExpired(stamped, now + 13 * HOUR)).toBe(true)
  })

  it('a remembered session survives a fortnight and dies within the month', () => {
    const stamped = expiryFor(true, now)
    expect(sessionExpired(stamped, now + 14 * DAY)).toBe(false)
    expect(sessionExpired(stamped, now + 31 * DAY)).toBe(true)
  })

  /**
   * The deploy-day case. Sessions minted before this shipped carry no
   * deadline, and failing them closed would sign out the whole agency for a
   * security improvement none of them was offered. They stay bounded by
   * Auth.js's own 30-day cap, exactly as they were yesterday.
   */
  it('treats a missing deadline as not-expired rather than locking everyone out', () => {
    expect(sessionExpired(undefined, now)).toBe(false)
    expect(sessionExpired(null, now)).toBe(false)
  })
})
