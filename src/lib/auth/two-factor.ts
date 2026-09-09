/**
 * Whether a second factor is demanded, and whether to offer it — the
 * decisions, without the wiring.
 *
 * Pure and separate from `challenge.ts` for a reason this codebase has
 * already paid for once: that module imports the database, and a test file
 * that reaches the database import fails env validation and silently loads
 * zero tests. These are the most consequential lines in the sign-in path,
 * and they are not allowed to be the untested ones.
 */

export interface TwoFactorInputs {
  /** This person's own setting. The default, and off to begin with. */
  readonly userEnabled: boolean
  /** `AUTH_2FA` — `"required"` mandates it for everyone, whatever they chose. */
  readonly orgSetting: string | undefined | null
  /** Whether a code could actually be delivered right now. */
  readonly mailConfigured: boolean
}

/**
 * Mail is checked first and vetoes everything, and that is not a convenience.
 *
 * Demanding a code that cannot be sent locks an account out with no way back
 * in: the person would have to sign in to change the setting, and signing in
 * is the thing they cannot do. That is true of the org mandate — where it
 * would take out everyone including the owner who set it — and equally true
 * of one person's own choice, where they would lock only themselves out but
 * would still need somebody else to dig them out.
 *
 * So a working mailer is the precondition for both. Setting `AUTH_2FA`
 * before email works, or ticking the box on a day the mailer is down, is
 * survivable: nothing happens until there is a way to deliver what it asks
 * for.
 *
 * The failure this leaves is the opposite one — email breaks and the second
 * factor quietly stops being asked for. Accepted deliberately as the lesser
 * of the two: it is visible (the login screen stops mentioning a code, and
 * Profile says so) and it is recoverable, where a lockout is recoverable by
 * nobody inside the agency.
 */
export function twoFactorDecision(inputs: TwoFactorInputs): boolean {
  if (!inputs.mailConfigured) return false
  return inputs.userEnabled || inputs.orgSetting === 'required'
}

/**
 * Whether Home should offer to turn it on.
 *
 * Three reasons not to, and the third is the one the X writes.
 *
 * Not offered when email is not configured: the offer would be a button that
 * enables a thing which then does nothing, and the person would reasonably
 * believe they were protected.
 */
export function shouldOfferTwoFactor(inputs: {
  readonly userEnabled: boolean
  readonly dismissedAt: Date | string | null | undefined
  readonly mailConfigured: boolean
}): boolean {
  if (!inputs.mailConfigured) return false
  if (inputs.userEnabled) return false
  // Any value at all means they said no. See the column's own comment.
  if (inputs.dismissedAt !== null && inputs.dismissedAt !== undefined) return false
  return true
}

/**
 * What Profile says about the setting.
 *
 * Split out because "on" and "on, but nothing can be sent" are different
 * states and a toggle that shows only the first is lying about the second.
 */
export type TwoFactorStatus = 'on' | 'off' | 'on-but-undeliverable' | 'unavailable'

export function twoFactorStatus(inputs: {
  readonly userEnabled: boolean
  readonly mailConfigured: boolean
}): TwoFactorStatus {
  if (inputs.userEnabled) return inputs.mailConfigured ? 'on' : 'on-but-undeliverable'
  return inputs.mailConfigured ? 'off' : 'unavailable'
}
