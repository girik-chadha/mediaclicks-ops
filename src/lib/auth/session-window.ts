/**
 * How long a session lives, and the choice that decides it.
 *
 * Pure, and deliberately not next to the Auth.js config: this is the whole
 * behaviour of "keep me signed in on this device", and it should be provable
 * without a browser, a database or a running app.
 *
 * ## Why this is enforced here and not by the token's own expiry
 *
 * The obvious implementation is to set `token.exp` in the `jwt` callback —
 * short for a guest, long for a remembered device — and let the JWT expire
 * itself. It does not work, and it fails silently, which is worse.
 * `@auth/core/jwt`'s `encode()` ends with:
 *
 *     .setExpirationTime(now() + maxAge)
 *
 * unconditionally, where `maxAge` is the one static value from the session
 * config. Any `exp` written in a callback is overwritten on the way out. The
 * sign-in would look correct, the box would appear to work, and every
 * unremembered session would quietly last thirty days — the exact failure
 * the feature exists to prevent.
 *
 * So the deadline travels as an ordinary claim and is checked on every
 * request instead. That also matches how this codebase already treats
 * tokens (ADR 0005): permissions are re-read per request rather than carried
 * in the JWT, because a token you trust is a token you cannot revoke. A
 * session window is the same shape of problem.
 */

/** A month, matching Auth.js's own default — "remember" keeps today's reach. */
export const REMEMBERED_DAYS = 30

/**
 * A single working day.
 *
 * The alternative reading of "don't remember me" is a browser-session cookie
 * that dies when the window closes. That is client-controlled and, in
 * practice, does not die: every major browser now restores tabs and cookies
 * on relaunch by default, so "log me out when I close it" silently means
 * "keep me signed in". Twelve hours is a real deadline the server enforces,
 * and it is the honest version of the promise the checkbox makes on a shared
 * or borrowed machine.
 */
export const UNREMEMBERED_HOURS = 12

export const REMEMBERED_MS = REMEMBERED_DAYS * 24 * 60 * 60 * 1000
export const UNREMEMBERED_MS = UNREMEMBERED_HOURS * 60 * 60 * 1000

export function sessionWindowMs(remember: boolean): number {
  return remember ? REMEMBERED_MS : UNREMEMBERED_MS
}

/** The absolute deadline stamped at sign-in. Absolute, not sliding. */
export function expiryFor(remember: boolean, now: number = Date.now()): number {
  return now + sessionWindowMs(remember)
}

/**
 * Whether a session has outlived its window.
 *
 * An absent deadline is *not* treated as expired. Tokens issued before this
 * shipped carry no claim, and failing them closed would sign out the whole
 * agency the moment it deploys — for a security improvement none of them had
 * the chance to opt into. Those sessions stay bounded by Auth.js's own
 * thirty-day cap, which is exactly what governed them before, so the change
 * is "no worse than yesterday" rather than "everyone out". They acquire a
 * real deadline the next time they sign in.
 */
export function sessionExpired(
  expiresAt: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (expiresAt === null || expiresAt === undefined) return false
  return expiresAt <= now
}
