import 'server-only'
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import type { Actor, PermissionKey } from '@/lib/permissions'
import { db } from '../db'
import { permissions, rolePermissions, roles, userRoles, users } from '../db/schema'
import { auth } from './index'

/**
 * The server-side actor: everything `can()` needs, plus the identity fields
 * needed to write an audit row and to phrase an error in §8's voice.
 *
 * `Actor` itself stays minimal — id, orgId, permissions — so that
 * src/lib/permissions never has to know what a user record looks like.
 */
export interface SessionActor extends Actor {
  readonly email: string
  readonly fullName: string
  /**
   * The user's stored IANA zone, not the browser's. Rendering from a single
   * server-known zone means the server and client agree, so no timestamp can
   * cause a hydration mismatch.
   */
  readonly timezone: string
  /**
   * Display only — for the avatar menu and the team screen.
   *
   * Nothing branches on these. Authorization reads `permissions`, never a
   * role name, which is what lets the Owner define custom roles from the UI
   * without a deploy (§3).
   */
  readonly roleNames: readonly string[]
}

/**
 * Resolves the current actor, flattening every role they hold into one
 * permission set.
 *
 * Wrapped in React's `cache`, so the several server components and route
 * handlers that ask for it during one request share a single query.
 *
 * Permissions are read from the database per request rather than carried in
 * the JWT — see docs/adr/0005-permissions-resolved-per-request.md. The short
 * version: a token that carries permissions cannot be de-escalated until it
 * expires, so revoking a permission in the matrix UI would not take effect.
 */
export const getActor = cache(async (): Promise<SessionActor | null> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const found = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      email: users.email,
      fullName: users.fullName,
      timezone: users.timezone,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const user = found[0]

  // Deleted or deactivated since the token was issued. Checked here rather
  // than trusting the JWT, which is why deactivation takes effect on the next
  // request instead of at token expiry.
  if (!user || user.deactivatedAt) return null

  const [granted, held] = await Promise.all([
    db
      .selectDistinct({ key: permissions.key })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId)),

    db
      .select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId)),
  ])

  return {
    id: user.id,
    orgId: user.orgId,
    email: user.email,
    fullName: user.fullName,
    timezone: user.timezone,
    roleNames: held.map((row) => row.name),
    permissions: new Set(granted.map((row) => row.key as PermissionKey)),
  }
})

/** As `getActor`, but for code paths that have no meaning without a user. */
export async function requireActor(): Promise<SessionActor> {
  const actor = await getActor()
  if (!actor) throw new UnauthenticatedError()
  return actor
}

export class UnauthenticatedError extends Error {
  override readonly name = 'UnauthenticatedError'
  constructor() {
    super('Sign in to continue')
  }
}
