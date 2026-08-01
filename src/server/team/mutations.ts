import 'server-only'
import { and, eq, ne } from 'drizzle-orm'
import { requirePermission } from '../auth/require'
import { db } from '../db'
import { auditLog, roles, userRoles, users } from '../db/schema'
import { inOrg } from '../scope'

export class LastOwnerError extends Error {
  override readonly name = 'LastOwnerError'
  constructor() {
    super('There must be at least one owner.')
  }
}

/**
 * Moves a person to a different role.
 *
 * §3 requires that at least one Owner always exists. No constraint can
 * express "at least one row matching a join must survive", so it is enforced
 * here — inside the transaction, after the write, re-reading through the same
 * transaction. Checking before the write would race with a concurrent
 * demotion and let both succeed, leaving an org with no owner.
 */
export async function setUserRole(userId: string, roleName: string): Promise<void> {
  const actor = await requirePermission('user.manage')

  await db.transaction(async (tx) => {
    const target = await tx
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(and(inOrg(users, actor), eq(users.id, userId)))
      .limit(1)

    const person = target[0]
    if (!person) throw new Error('That person is no longer in this organisation.')

    const role = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(and(inOrg(roles, actor), eq(roles.name, roleName)))
      .limit(1)

    const nextRole = role[0]
    if (!nextRole) throw new Error(`There is no ${roleName} role.`)

    const previous = await tx
      .select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))

    await tx.delete(userRoles).where(eq(userRoles.userId, userId))
    await tx.insert(userRoles).values({ userId, roleId: nextRole.id })

    // Re-read after the write, in this transaction.
    const ownersLeft = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(inOrg(roles, actor), eq(roles.name, 'Owner')))

    if (ownersLeft.length === 0) throw new LastOwnerError()

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'user.role_changed',
      entityType: 'user',
      entityId: userId,
      before: { email: person.email, roles: previous.map((r) => r.name).sort() },
      after: { email: person.email, roles: [nextRole.name] },
    })
  })
}

/** Everyone in the org who currently holds Owner. Used to lock the last one. */
export async function countOwners(orgId: string): Promise<number> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.orgId, orgId), eq(roles.name, 'Owner'), ne(userRoles.userId, '')))
  return rows.length
}
