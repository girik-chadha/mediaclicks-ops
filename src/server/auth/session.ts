import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
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
  readonly phoneE164: string | null
  readonly dailyDigest: boolean
  readonly digestTime: string
  readonly reminderLeadMinutes: number
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
      phoneE164: users.phoneE164,
      dailyDigest: users.dailyDigest,
      digestTime: users.digestTime,
      reminderLeadMinutes: users.reminderLeadMinutes,
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

  /**
   * Roles and permissions in one round trip.
   *
   * These were two queries, run in parallel but still two waits on the wire.
   * A round trip to this database measures ~160ms, so the join is worth more
   * than the handful of duplicate role names it returns — a person holds one
   * or two roles, and folding them in memory is free.
   */
  const grants = await db
    .select({ roleName: roles.name, permissionKey: permissions.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId))

  const roleNames = [...new Set(grants.map((g) => g.roleName))]
  const permissionKeys = new Set(
    grants.flatMap((g) => (g.permissionKey ? [g.permissionKey as PermissionKey] : [])),
  )

  return {
    id: user.id,
    orgId: user.orgId,
    email: user.email,
    fullName: user.fullName,
    timezone: user.timezone,
    phoneE164: user.phoneE164,
    dailyDigest: user.dailyDigest,
    digestTime: user.digestTime,
    reminderLeadMinutes: user.reminderLeadMinutes,
    roleNames,
    permissions: permissionKeys,
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

/**
 * Where a page goes when `getActor()` returns null.
 *
 * Deliberately not `/login`. Getting here means middleware already accepted
 * the cookie — it is authentic — but the user it names is not in this
 * database, so sending them to /login just makes middleware bounce them back
 * with the same valid cookie. See src/app/api/stale-session/route.ts for the
 * full loop and why only the Node side can detect it.
 *
 * The cast exists because `typedRoutes` builds its union from pages, and this
 * is a route handler. That is also exactly why it works: route handlers live
 * under /api, which the middleware matcher skips, and a route whose job is to
 * escape a redirect loop must not be inside one.
 */
export function redirectStaleSession(): never {
  redirect('/api/stale-session' as Parameters<typeof redirect>[0])
}
