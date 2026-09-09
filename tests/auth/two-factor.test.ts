import { describe, expect, it } from 'vitest'
import {
  shouldOfferTwoFactor,
  twoFactorDecision,
  twoFactorStatus,
} from '@/lib/auth/two-factor'

/**
 * Who gets asked for a code, who gets offered one, and what Profile says.
 *
 * The cases that matter are the ones where something is off: mail missing,
 * a mandate over a personal choice, and a preference stored for a thing that
 * cannot currently happen.
 */

describe('who is asked for a code', () => {
  it('asks the person who turned it on', () => {
    expect(
      twoFactorDecision({ userEnabled: true, orgSetting: undefined, mailConfigured: true }),
    ).toBe(true)
  })

  it('does not ask the person who did not', () => {
    expect(
      twoFactorDecision({ userEnabled: false, orgSetting: undefined, mailConfigured: true }),
    ).toBe(false)
  })

  it('asks everyone when the organisation mandates it', () => {
    // The point of the mandate: it overrides the individual's "off".
    expect(
      twoFactorDecision({ userEnabled: false, orgSetting: 'required', mailConfigured: true }),
    ).toBe(true)
  })

  /**
   * The lockout guard, and the reason the mail check comes first.
   *
   * Demanding a code that cannot be sent locks the account out permanently:
   * changing the setting requires signing in, and signing in is exactly what
   * is now impossible. True of one person's own choice, and catastrophically
   * true of the mandate, which would take out the owner who set it.
   */
  it('asks nobody when no code could be delivered', () => {
    expect(
      twoFactorDecision({ userEnabled: true, orgSetting: undefined, mailConfigured: false }),
    ).toBe(false)
    expect(
      twoFactorDecision({ userEnabled: true, orgSetting: 'required', mailConfigured: false }),
    ).toBe(false)
    expect(
      twoFactorDecision({ userEnabled: false, orgSetting: 'required', mailConfigured: false }),
    ).toBe(false)
  })

  it('does not treat near-misses as a mandate', () => {
    // Fail toward "not asked" rather than toward a lockout: a typo in an
    // environment variable must not be able to shut the agency out.
    for (const nearMiss of ['Required', 'REQUIRED', 'true', '1', 'yes', 'on', '']) {
      expect(
        twoFactorDecision({ userEnabled: false, orgSetting: nearMiss, mailConfigured: true }),
      ).toBe(false)
    }
  })
})

describe('who is offered it on Home', () => {
  it('offers it to somebody who has neither enabled nor declined', () => {
    expect(
      shouldOfferTwoFactor({ userEnabled: false, dismissedAt: null, mailConfigured: true }),
    ).toBe(true)
  })

  it('stops offering once it is on', () => {
    expect(
      shouldOfferTwoFactor({ userEnabled: true, dismissedAt: null, mailConfigured: true }),
    ).toBe(false)
  })

  it('never offers again once dismissed', () => {
    // The X says "don't show this again", so it has to mean that. A nudge
    // that returns anyway teaches people to ignore the spot it appears in.
    expect(
      shouldOfferTwoFactor({
        userEnabled: false,
        dismissedAt: new Date('2020-01-01'),
        mailConfigured: true,
      }),
    ).toBe(false)
  })

  it('does not offer what cannot be delivered', () => {
    // Otherwise the button enables a protection that does nothing, and the
    // person walks away believing they are covered.
    expect(
      shouldOfferTwoFactor({ userEnabled: false, dismissedAt: null, mailConfigured: false }),
    ).toBe(false)
  })
})

describe('what Profile says', () => {
  it('separates "on" from "on but undeliverable"', () => {
    expect(twoFactorStatus({ userEnabled: true, mailConfigured: true })).toBe('on')
    // Switched on, protecting nothing. Rendering this identically to "on"
    // would be lying by omission about the one state that matters.
    expect(twoFactorStatus({ userEnabled: true, mailConfigured: false })).toBe(
      'on-but-undeliverable',
    )
  })

  it('separates "off" from "cannot be turned on"', () => {
    expect(twoFactorStatus({ userEnabled: false, mailConfigured: true })).toBe('off')
    expect(twoFactorStatus({ userEnabled: false, mailConfigured: false })).toBe(
      'unavailable',
    )
  })
})
