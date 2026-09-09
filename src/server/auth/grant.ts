import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The handoff between "the code was right" and "a session exists".
 *
 * `authorize()` is the only door to a session, and it takes credentials. By
 * the time the second factor is accepted there is no password to give it —
 * carrying one through two screens so it could be re-checked at the end
 * would mean holding a password in a form field across a round trip, which
 * is worse than the problem it solves.
 *
 * So the second step presents this instead: a signed, sixty-second assertion
 * that *this server* just verified a code for this user. `authorize()`
 * checks the signature, re-reads the account, and mints the session.
 *
 * Same construction as the assistant's `seal()` and for the same reason —
 * something crosses the browser and has to come back trustworthy — but kept
 * separate rather than shared. That one is bound to an actor who is already
 * signed in and lives fifteen minutes; this one *creates* the signed-in
 * actor and must live seconds. Merging them would mean one TTL serving two
 * threat models, and the login side would inherit the looser one.
 *
 * Replay inside the window is bounded by the challenge itself: the row is
 * marked consumed in the same transaction that validated the code, so a
 * captured grant cannot be exchanged for a second session after the first —
 * `authorize()` re-checks the account, and a replayed grant produces the
 * same session for the same person rather than new authority.
 */

const TTL_MS = 60_000

interface Grant {
  readonly userId: string
  readonly remember: boolean
  readonly expiresAt: number
}

export class GrantError extends Error {
  override readonly name = 'GrantError'
}

function secret(): string {
  // The same secret that signs session cookies. If it is missing there is no
  // working auth to degrade into, so failing loudly is the only honest option.
  const value = process.env.AUTH_SECRET
  if (!value) throw new GrantError('AUTH_SECRET is not set')
  return value
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function sealGrant(userId: string, remember: boolean): string {
  const grant: Grant = { userId, remember, expiresAt: Date.now() + TTL_MS }
  const payload = Buffer.from(JSON.stringify(grant), 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Returns null rather than throwing: every failure here is just "no". */
export function openGrant(token: string): Grant | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const payload = token.slice(0, dot)

  let provided: Buffer
  let expected: Buffer
  try {
    provided = Buffer.from(token.slice(dot + 1), 'base64url')
    expected = Buffer.from(sign(payload), 'base64url')
  } catch {
    return null
  }

  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  let grant: Grant
  try {
    grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Grant
  } catch {
    return null
  }

  // Checked after the signature, so a tampered payload never reaches here.
  if (typeof grant.userId !== 'string' || typeof grant.remember !== 'boolean') return null
  if (typeof grant.expiresAt !== 'number' || grant.expiresAt <= Date.now()) return null

  return grant
}
