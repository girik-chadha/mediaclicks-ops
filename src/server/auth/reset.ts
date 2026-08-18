import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { auditLog, passwordResetTokens, users } from '../db/schema'
import { mailIsConfigured, sendEmail } from '../mail'
import { hashPassword } from './password'

/**
 * Self-service password reset.
 *
 * Also how everybody gets their *first* password: accounts are created
 * without one, each person requests a reset, and the account becomes
 * reachable only after someone proves they read that mailbox. Nobody but the
 * account holder ever knows the password, and there is no list of temporary
 * credentials to hand round and then fail to delete.
 *
 * Three rules, in order of how much they matter:
 *
 *  1. **The request endpoint never says whether an account exists.** It
 *     reports the same thing for a real address, an unknown one and a
 *     deactivated one. An honest "no such user" turns the form into a
 *     membership oracle: anyone could test whether a given person works
 *     here, which is worth something to whoever is phishing them next.
 *
 *  2. **The token is a bearer credential and is stored only as a hash.**
 *     See the table's own comment.
 *
 *  3. **Consuming a token and setting the password are one transaction.** A
 *     token marked used but a password unchanged locks someone out of an
 *     account they legitimately own; the reverse hands out a reusable key.
 */

const TOKEN_BYTES = 32
const TTL_MINUTES = 60

/** Per address, per hour. Enough for a mistyped inbox, not enough to spam. */
const MAX_REQUESTS_PER_HOUR = 5

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

export class ResetUnavailableError extends Error {
  override readonly name = 'ResetUnavailableError'
  constructor() {
    super(
      'Password reset is not switched on — email is not configured. Ask an owner to set your password directly.',
    )
  }
}

/**
 * Issues a reset if the address belongs to an active account.
 *
 * Returns nothing either way. The caller shows the same message regardless,
 * and giving it a boolean would be handing it the thing it must not reveal.
 */
export async function requestPasswordReset(
  rawEmail: string,
  origin: string,
): Promise<void> {
  if (!mailIsConfigured()) throw new ResetUnavailableError()

  const email = rawEmail.trim().toLowerCase()
  if (!email.includes('@')) return

  const [user] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deactivatedAt)))
    .limit(1)

  // No such account, or a deactivated one. Nothing sent, nothing said.
  if (!user) return

  const hourAgo = new Date(Date.now() - 60 * 60_000)
  const recent = await db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.userId, user.id),
        gt(passwordResetTokens.createdAt, hourAgo),
      ),
    )

  // Silently, for the same reason as above: "you have asked too often" also
  // confirms the address is real.
  if (recent.length >= MAX_REQUESTS_PER_HOUR) return

  const token = randomBytes(TOKEN_BYTES).toString('base64url')

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000),
  })

  const link = `${origin.replace(/\/$/, '')}/reset/${token}`
  const firstName = user.fullName.trim().split(/\s+/)[0] ?? 'there'

  await sendEmail({
    to: user.email,
    subject: 'Set your MediaClicks password',
    text:
      `Hello ${firstName},\n\n` +
      `Open this link to set a new password. It works once and expires in ${TTL_MINUTES} minutes.\n\n` +
      `${link}\n\n` +
      'If you did not ask for this, you can ignore it — nothing has changed, and\n' +
      'the link stops working on its own.\n\n' +
      'MediaClicks Operations\n',
  })
}

export type ResetOutcome =
  | { ok: true; email: string }
  | { ok: false; reason: string }

/** Whether a token is worth showing a form for, without spending it. */
export async function checkResetToken(token: string): Promise<ResetOutcome> {
  const [row] = await db
    .select({
      id: passwordResetTokens.id,
      usedAt: passwordResetTokens.usedAt,
      expiresAt: passwordResetTokens.expiresAt,
      email: users.email,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, sha256(token)))
    .limit(1)

  if (!row) return { ok: false, reason: 'That link is not valid.' }
  if (row.usedAt) return { ok: false, reason: 'That link has already been used.' }
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'That link has expired. Ask for a new one.' }
  }
  return { ok: true, email: row.email }
}

/**
 * Spends a token and sets the password, or does neither.
 *
 * The token is re-checked *inside* the transaction and the update is
 * conditional on `used_at IS NULL`, so two requests arriving together cannot
 * both succeed — the second updates no rows and is refused. Checking first
 * and writing after would let both through.
 */
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<ResetOutcome> {
  if (newPassword.length < 12) {
    return { ok: false, reason: 'Use at least 12 characters.' }
  }
  if (newPassword.length > 1024) {
    return { ok: false, reason: 'That password is too long.' }
  }

  const tokenHash = sha256(token)
  const passwordHash = await hashPassword(newPassword)

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        usedAt: passwordResetTokens.usedAt,
        expiresAt: passwordResetTokens.expiresAt,
        email: users.email,
        orgId: users.orgId,
      })
      .from(passwordResetTokens)
      .innerJoin(users, eq(users.id, passwordResetTokens.userId))
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1)

    if (!row) return { ok: false as const, reason: 'That link is not valid.' }
    if (row.usedAt) return { ok: false as const, reason: 'That link has already been used.' }
    if (row.expiresAt.getTime() < Date.now()) {
      return { ok: false as const, reason: 'That link has expired. Ask for a new one.' }
    }

    const spent = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)),
      )
      .returning({ id: passwordResetTokens.id })

    // Someone else spent it between the read and the write.
    if (spent.length === 0) {
      return { ok: false as const, reason: 'That link has already been used.' }
    }

    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId))

    // Every other outstanding link for this account stops working. Somebody
    // resetting because they suspect a compromise should not leave a second
    // valid key in the attacker's inbox.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, row.userId),
          isNull(passwordResetTokens.usedAt),
        ),
      )

    await tx.insert(auditLog).values({
      orgId: row.orgId,
      actorUserId: row.userId,
      actorEmail: row.email,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: row.userId,
      before: null,
      // Never the password, nor the token. An audit log is read by people.
      after: { email: row.email, method: 'self-service reset link' },
    })

    return { ok: true as const, email: row.email }
  })
}

/**
 * Deletes spent and expired tokens older than a week.
 *
 * Not on a schedule — called opportunistically from the request path, where
 * it costs one cheap DELETE on a small table and needs no new cron entry.
 */
export async function pruneResetTokens(): Promise<void> {
  await db
    .delete(passwordResetTokens)
    .where(sql`${passwordResetTokens.createdAt} < now() - interval '7 days'`)
}

/** Most recent request per user. Only used by tests and diagnostics. */
export async function latestTokenFor(userId: string) {
  const [row] = await db
    .select({
      id: passwordResetTokens.id,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, userId))
    .orderBy(desc(passwordResetTokens.createdAt))
    .limit(1)
  return row ?? null
}

/** Constant-time compare, for anywhere a token is checked outside SQL. */
export function tokensMatch(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a), 'hex')
  const y = Buffer.from(sha256(b), 'hex')
  return x.length === y.length && timingSafeEqual(x, y)
}
