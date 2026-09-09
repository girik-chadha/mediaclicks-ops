/**
 * Whether a second factor is demanded — the decision, without the wiring.
 *
 * Pure and separate from `challenge.ts` for a reason this codebase has
 * already paid for once: that module imports the database, and a test file
 * that reaches the database import fails env validation and silently loads
 * zero tests. The rule below is the single most consequential line in the
 * sign-in path, and it is not allowed to be the untested one.
 */

/**
 * Both conditions are required, and the second is not a convenience.
 *
 * `AUTH_2FA=required` on its own would brick the product the moment it were
 * set before email worked: no code can be sent, so no session can be created,
 * so nobody — including the owner who set the variable — can get in to unset
 * it. Requiring a working mailer as well means the variable can be set ahead
 * of time and only starts demanding a code once there is a way to deliver
 * one.
 *
 * The failure this leaves is the opposite one: email breaks, and the second
 * factor stops being asked for. That is a real downgrade, and it is the
 * lesser of the two, because it is *recoverable and visible* — the login
 * screen stops mentioning a code, and the go-live runbook says to check it.
 * A silent lockout of an entire agency from its own calendar is recoverable
 * by nobody inside that agency.
 */
export function twoFactorDecision(
  setting: string | undefined | null,
  mailConfigured: boolean,
): boolean {
  return setting === 'required' && mailConfigured
}
