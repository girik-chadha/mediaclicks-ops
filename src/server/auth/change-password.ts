import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { auditLog, passwordResetTokens, users } from '../db/schema'
import { hashPassword, verifyPassword } from './password'
import { requireActor } from './session'

/**
 * Changing your own password, from inside the app.
 *
 * Replaces the command-line stopgap in `scripts/set-password.ts` for the
 * ordinary case. No permission key: this is the session's own row and
 * nothing else, and the current password is the authorisation — a stolen
 * session cookie alone cannot use this to lock the real owner out, because
 * the thief does not have the thing the form asks for first.
 *
 * The rules are the reset flow's, so a password chosen either way meets the
 * same bar:
 *
 *  - at least 12 characters (`reset.ts` enforces the same)
 *  - the new one must differ from the current one — not for security, but
 *    because someone who "changed" it to the same value believes something
 *    happened that did not
 */

export const MIN_PASSWORD_LENGTH = 12

export type ChangeOutcome = { ok: true } | { ok: false; reason: string }

/**
 * A hash of a value nobody can supply, so an account with no password takes
 * as long to refuse as one with the wrong password. Same reasoning as the
 * sign-in providers' decoys; not strictly necessary here (the caller is
 * already signed in) but it costs nothing to be consistent.
 */
const decoyHash = hashPassword(
  'decoy-3c9a1f0e-not-a-real-password-used-only-for-constant-time-failure',
)

export async function changePassword(
  current: string,
  next: string,
  confirm: string,
): Promise<ChangeOutcome> {
  const actor = await requireActor()

  if (next !== confirm) return { ok: false, reason: 'Those two new passwords are different.' }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (next.length > 1024) return { ok: false, reason: 'That password is too long.' }
  if (next === current) {
    return { ok: false, reason: 'That is already your password. Choose a different one.' }
  }

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1)

  // Created without a password, or signs in with Google only. There is no
  // "current password" to verify, and the honest route to setting one is the
  // same emailed link everybody used to set their first.
  if (!row?.passwordHash) {
    await verifyPassword(await decoyHash, current)
    return {
      ok: false,
      reason:
        'This account has no password to change yet. Sign out and use "Forgot password" to set one.',
    }
  }

  const ok = await verifyPassword(row.passwordHash, current)
  if (!ok) return { ok: false, reason: 'That is not your current password.' }

  const passwordHash = await hashPassword(next)

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, actor.id))

    // Any reset link still sitting in an inbox stops working. Someone
    // changing their password because they suspect a compromise should not
    // leave a second valid key behind.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, actor.id), isNull(passwordResetTokens.usedAt)))

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'user.password_changed',
      entityType: 'user',
      entityId: actor.id,
      before: null,
      // Never the password, nor either hash. An audit log is read by people.
      after: { email: actor.email, method: 'profile, with current password' },
    })
  })

  return { ok: true }
}
