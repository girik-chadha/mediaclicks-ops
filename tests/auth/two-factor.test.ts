import { describe, expect, it } from 'vitest'
import { twoFactorDecision } from '@/lib/auth/two-factor'

/**
 * One rule, and the case that matters is the third one.
 */
describe('when a second factor is demanded', () => {
  it('is demanded when it is switched on and email works', () => {
    expect(twoFactorDecision('required', true)).toBe(true)
  })

  it('is not demanded when it is switched off', () => {
    expect(twoFactorDecision(undefined, true)).toBe(false)
    expect(twoFactorDecision('', true)).toBe(false)
    expect(twoFactorDecision('off', true)).toBe(false)
  })

  /**
   * The lockout guard, and the reason this function exists at all.
   *
   * Demanding a code that cannot be sent locks every account out of the
   * product permanently — including the owner, who would need to sign in to
   * undo it and cannot. Setting the variable before email is working has to
   * be survivable, because someone will do it in that order.
   */
  it('is not demanded when the code could not be delivered', () => {
    expect(twoFactorDecision('required', false)).toBe(false)
  })

  it('does not accept near-misses as switching it on', () => {
    // Fail toward "no second factor" rather than toward a lockout: a typo in
    // an environment variable should not be able to shut the agency out.
    for (const nearMiss of ['Required', 'REQUIRED', 'true', '1', 'yes', 'on']) {
      expect(twoFactorDecision(nearMiss, true)).toBe(false)
    }
  })
})
