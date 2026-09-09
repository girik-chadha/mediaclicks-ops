import 'server-only'
import { eq } from 'drizzle-orm'
import { auditLog, users } from '../db/schema'
import { db } from '../db'
import { mailIsConfigured } from '../mail'
import { requireActor } from './session'

/**
 * Turning the second factor on and off, for yourself.
 *
 * No permission check and none wanted: this is a person's own account, and
 * `can()` governs what someone may do to *other* people's rows. The actor is
 * resolved from the session and is the only row any of these touch — there
 * is no id parameter to tamper with, which is a stronger guarantee than a
 * permission check on one that exists.
 *
 * Every change writes an audit row. Turning a second factor off is exactly
 * the move somebody makes with a stolen session before doing something
 * worse, and an account-security change with no trace behind it is the one
 * kind this log cannot afford to miss.
 */

export class TwoFactorUnavailableError extends Error {
  override readonly name = 'TwoFactorUnavailableError'
  constructor() {
    super(
      'Email is not set up, so a sign-in code could not be delivered. Ask an owner to configure it first.',
    )
  }
}

async function record(
  actor: { id: string; orgId: string; email: string },
  action: string,
  before: boolean,
  after: boolean,
): Promise<void> {
  await db.insert(auditLog).values({
    orgId: actor.orgId,
    actorUserId: actor.id,
    actorEmail: actor.email,
    action,
    entityType: 'user',
    entityId: actor.id,
    before: { twoFactorEnabled: before },
    after: { twoFactorEnabled: after },
  })
}

/**
 * Refused when email is not configured.
 *
 * The alternative — store the preference and honour it later — means someone
 * ticks a box, is told they are protected, and is not. `twoFactorDecision`
 * would ignore the setting anyway, so the only thing that would have changed
 * is what the person believes.
 */
export async function enableTwoFactor(): Promise<void> {
  const actor = await requireActor()
  if (!mailIsConfigured()) throw new TwoFactorUnavailableError()

  await db
    .update(users)
    .set({ twoFactorEnabled: true, twoFactorPromptDismissedAt: new Date() })
    .where(eq(users.id, actor.id))

  await record(actor, 'user.two_factor_enabled', false, true)
}

export async function disableTwoFactor(): Promise<void> {
  const actor = await requireActor()

  // Not gated on mail being configured. Someone whose mailer has broken is
  // exactly who needs to be able to turn this off, and refusing here would
  // be the lockout the whole design avoids.
  await db
    .update(users)
    .set({ twoFactorEnabled: false })
    .where(eq(users.id, actor.id))

  await record(actor, 'user.two_factor_disabled', true, false)
}

/**
 * "Not now" on the Home offer.
 *
 * Not audited: declining a suggestion is not a change to the account's
 * security, and a log that records every dismissal of every nudge is a log
 * nobody reads.
 */
export async function dismissTwoFactorPrompt(): Promise<void> {
  const actor = await requireActor()
  await db
    .update(users)
    .set({ twoFactorPromptDismissedAt: new Date() })
    .where(eq(users.id, actor.id))
}
