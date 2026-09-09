import 'server-only'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { twoFactorDecision } from '@/lib/auth/two-factor'
import { db } from '../db'
import { loginChallenges, users } from '../db/schema'
import { mailIsConfigured, sendEmail } from '../mail'
import { hashPassword, verifyPassword } from './password'

/**
 * The second step of signing in: a code sent to the address on the account.
 *
 * Split from the credentials provider on purpose. `authorize()` can only
 * answer yes or no — it either returns a user and a session exists, or it
 * returns null and none does. There is no "correct password, not finished
 * yet" it can express. So the password check moved here, where it can end in
 * a third state, and `authorize()` is handed the *result* of the code check
 * rather than the password.
 *
 * That split is also what stops the obvious attack on a two-step login:
 * because no session exists until the code is accepted, knowing a password
 * gets you a challenge row and an email to somebody else's inbox, and
 * nothing else.
 *
 * Per person, off by default: each account opts in from Profile, or is
 * offered it once on Home. `AUTH_2FA=required` still overrides that for
 * everyone. Either way a working mailer is the precondition — see
 * src/lib/auth/two-factor.ts for why that veto is not a convenience.
 */

const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5

/** Per account, per hour. A mistyped password a few times over, not a flood. */
const MAX_CHALLENGES_PER_HOUR = 6

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

/** Salted with the row id — see the table's comment for why that matters. */
const hashCode = (challengeId: string, code: string): string =>
  sha256(`${challengeId}:${code}`)

/** The decision lives in lib and is tested there; this is only the wiring. */
export function twoFactorRequiredFor(userEnabled: boolean): boolean {
  return twoFactorDecision({
    userEnabled,
    orgSetting: process.env.AUTH_2FA,
    mailConfigured: mailIsConfigured(),
  })
}

/**
 * Whether *anyone at all* could be asked for a code right now.
 *
 * Only for copy on the login screen, which has no idea yet who is typing —
 * it cannot say "we'll email you a code" for a person whose account may not
 * use one. Never used to decide anything.
 */
export function twoFactorPossible(): boolean {
  return mailIsConfigured()
}

/**
 * A hash of a value nobody can supply, verified against when no user matches.
 *
 * Same reasoning as the credentials provider's own decoy: without it, an
 * unknown address returns in microseconds and a known one takes ~50ms of
 * argon2, and that difference tells an attacker who works here.
 */
const decoyHash = hashPassword(
  'decoy-8f21c07a-not-a-real-password-used-only-for-constant-time-failure',
)

export type ChallengeStart =
  /** Password accepted. A code is on its way; carry this id to step two. */
  | { readonly status: 'sent'; readonly challengeId: string; readonly email: string }
  /** Wrong password, no such account, or deactivated — indistinguishable. */
  | { readonly status: 'rejected' }
  /** Password was right, but the code could not be delivered. */
  | { readonly status: 'undeliverable' }
  /**
   * Password was right and this account does not use a second factor.
   *
   * Reported rather than signed in here, because minting the session is
   * `authorize()`'s job and this module deliberately has no way to create
   * one. The caller does the ordinary single-step sign-in.
   */
  | { readonly status: 'not-required' }

/**
 * Checks a password and, if it is right, issues and sends a code.
 *
 * Returns `rejected` for a wrong password, an unknown address and a
 * deactivated account alike. The caller shows one message for all three, for
 * the same reason the password reset endpoint does: a login form that
 * distinguishes them is a membership oracle for whoever is phishing this
 * agency next.
 */
export async function startLoginChallenge(
  rawEmail: string,
  password: string,
  remember: boolean,
): Promise<ChallengeStart> {
  const email = rawEmail.trim().toLowerCase()

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      passwordHash: users.passwordHash,
      deactivatedAt: users.deactivatedAt,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (!user) {
    await verifyPassword(await decoyHash, password)
    return { status: 'rejected' }
  }

  const ok = await verifyPassword(user.passwordHash, password)
  if (!ok) return { status: 'rejected' }

  // After the password, so a deactivated account is indistinguishable from a
  // wrong one — matching the credentials provider.
  if (user.deactivatedAt) return { status: 'rejected' }

  /**
   * This account does not use a second factor. Checked here, after the
   * password, rather than before the lookup — deciding on the setting first
   * would mean answering "does this address use 2FA" to anyone who asks,
   * which is a fact about a person that an unauthenticated form should not
   * be handing out. Nothing is written and nothing is sent.
   */
  if (!twoFactorRequiredFor(user.twoFactorEnabled)) return { status: 'not-required' }

  const hourAgo = new Date(Date.now() - 60 * 60_000)
  const recent = await db
    .select({ id: loginChallenges.id })
    .from(loginChallenges)
    .where(
      and(eq(loginChallenges.userId, user.id), gt(loginChallenges.createdAt, hourAgo)),
    )

  // Reported as undeliverable rather than rejected: this person got their
  // password right, and telling them it was wrong would send them to reset a
  // password that is fine.
  if (recent.length >= MAX_CHALLENGES_PER_HOUR) return { status: 'undeliverable' }

  const challengeId = randomUUID()
  // randomInt, not Math.random: this is a credential, and Math.random is
  // seeded predictably enough to enumerate.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')

  await db.insert(loginChallenges).values({
    id: challengeId,
    userId: user.id,
    codeHash: hashCode(challengeId, code),
    remember,
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
  })

  const firstName = user.fullName.trim().split(/\s+/)[0] ?? 'there'

  try {
    await sendEmail({
      to: user.email,
      subject: `${code} is your MediaClicks sign-in code`,
      text:
        `Hello ${firstName},\n\n` +
        `Your sign-in code is ${code}\n\n` +
        `It expires in ${CODE_TTL_MINUTES} minutes and works once.\n\n` +
        'If you did not just try to sign in, someone else knows your password.\n' +
        'Change it from Forgot password, and nothing happens in the meantime —\n' +
        'this code is the only way in and it is in your inbox, not theirs.\n\n' +
        'MediaClicks Operations\n',
    })
  } catch {
    // The row stays. It expires on its own, and a challenge nobody can answer
    // is harmless — where saying "sent" when nothing was sent would leave
    // someone waiting on an email that is never coming.
    return { status: 'undeliverable' }
  }

  return { status: 'sent', challengeId, email: user.email }
}

export type ChallengeResult =
  | { readonly ok: true; readonly userId: string; readonly remember: boolean }
  | { readonly ok: false; readonly reason: string }

/**
 * Spends a code, or counts a wrong guess.
 *
 * Both halves happen inside one transaction, and the consuming update is
 * conditional on `consumed_at IS NULL`, so two requests arriving together
 * cannot both succeed. Reading first and writing after would let both
 * through — the same race the password reset guards, and the same fix.
 */
export async function verifyLoginChallenge(
  challengeId: string,
  rawCode: string,
): Promise<ChallengeResult> {
  const code = rawCode.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'Enter the six-digit code.' }

  // A malformed id is a bad request, not a database round trip.
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) {
    return { ok: false, reason: 'That code has expired. Start again.' }
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: loginChallenges.id,
        userId: loginChallenges.userId,
        codeHash: loginChallenges.codeHash,
        remember: loginChallenges.remember,
        attempts: loginChallenges.attempts,
        expiresAt: loginChallenges.expiresAt,
        consumedAt: loginChallenges.consumedAt,
        deactivatedAt: users.deactivatedAt,
      })
      .from(loginChallenges)
      .innerJoin(users, eq(users.id, loginChallenges.userId))
      .where(eq(loginChallenges.id, challengeId))
      .limit(1)

    // One message for expired, spent, unknown and burnt-through: none of them
    // are recoverable and distinguishing them only helps someone guessing.
    const dead = { ok: false as const, reason: 'That code has expired. Start again.' }

    if (!row) return dead
    if (row.consumedAt) return dead
    if (row.expiresAt.getTime() < Date.now()) return dead
    if (row.attempts >= MAX_ATTEMPTS) return dead

    // Deactivated between the password step and this one.
    if (row.deactivatedAt) return dead

    if (hashCode(row.id, code) !== row.codeHash) {
      await tx
        .update(loginChallenges)
        .set({ attempts: row.attempts + 1 })
        .where(eq(loginChallenges.id, row.id))

      const left = MAX_ATTEMPTS - (row.attempts + 1)
      return {
        ok: false as const,
        reason:
          left > 0
            ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
            : 'That code is not right. Start again.',
      }
    }

    const spent = await tx
      .update(loginChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(loginChallenges.id, row.id), isNull(loginChallenges.consumedAt)))
      .returning({ id: loginChallenges.id })

    // Someone else spent it between the read and the write.
    if (spent.length === 0) return dead

    return { ok: true as const, userId: row.userId, remember: row.remember }
  })
}

/**
 * Deletes challenges older than a day.
 *
 * Opportunistic, like the reset-token prune: one cheap DELETE on a small
 * table from a path that is already writing, rather than a cron entry for
 * housekeeping.
 */
export async function pruneLoginChallenges(): Promise<void> {
  await db
    .delete(loginChallenges)
    .where(sql`${loginChallenges.createdAt} < now() - interval '1 day'`)
}
