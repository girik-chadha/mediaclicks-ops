import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { PERMISSION_KEYS, type PermissionKey } from '@/lib/permissions'
import { requirePermission } from '../auth/require'
import { db } from '../db'
import { auditLog, permissions, rolePermissions, roles, userRoles } from '../db/schema'
import { inOrg } from '../scope'

/**
 * Custom roles (§3).
 *
 * The data model always allowed these — `roles` is per-organisation and
 * carries `is_system_role`, and nothing in the codebase branches on a role
 * name; `can()` reads the granted permission set. What was missing was any
 * way to create one, so an agency with a GFX team and a VFX team had three
 * bundles named Owner, Manager and Member and no way to say anything else.
 *
 * Everything here is gated on `role.manage`, which until now was a key no
 * code enforced. Owner holds it; Manager deliberately does not, because
 * editing a role edits what everyone holding it may do — that is closer to
 * changing the rules than to using them.
 *
 * Permission *keys* are not editable and never will be from the UI. A key
 * only means anything because there is code checking it, so inventing one
 * would mean inventing its enforcement. Roles are bundles of the fixed
 * vocabulary in src/lib/permissions/keys.ts.
 */

export class RoleInUseError extends Error {
  override readonly name = 'RoleInUseError'
  constructor(count: number) {
    super(
      `${count} ${count === 1 ? 'person still holds' : 'people still hold'} that role. ` +
        'Move them to another role first.',
    )
  }
}

export class SystemRoleError extends Error {
  override readonly name = 'SystemRoleError'
  constructor() {
    super('Owner, Manager and Member are built in and cannot be renamed or removed.')
  }
}

export class DuplicateRoleError extends Error {
  override readonly name = 'DuplicateRoleError'
  constructor(name: string) {
    super(`There is already a role called ${name}.`)
  }
}

export interface RoleDetail {
  id: string
  name: string
  isSystemRole: boolean
  permissionKeys: PermissionKey[]
  memberCount: number
}

/** Every role in the org, with what it grants and how many people hold it. */
export async function listRoles(orgId: string): Promise<RoleDetail[]> {
  const roleRows = await db
    .select({ id: roles.id, name: roles.name, isSystemRole: roles.isSystemRole })
    .from(roles)
    .where(eq(roles.orgId, orgId))
    .orderBy(roles.name)

  if (roleRows.length === 0) return []
  const ids = roleRows.map((r) => r.id)

  const [grants, holders] = await Promise.all([
    db
      .select({ roleId: rolePermissions.roleId, key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(rolePermissions.roleId, ids)),
    db
      .select({ roleId: userRoles.roleId, userId: userRoles.userId })
      .from(userRoles)
      .where(inArray(userRoles.roleId, ids)),
  ])

  return roleRows.map((r) => ({
    ...r,
    permissionKeys: grants
      .filter((g) => g.roleId === r.id)
      .map((g) => g.key as PermissionKey)
      .sort(),
    memberCount: holders.filter((h) => h.roleId === r.id).length,
  }))
}

/** Only keys the code actually enforces. Anything else is discarded. */
function known(keys: readonly string[]): PermissionKey[] {
  const valid = new Set<string>(PERMISSION_KEYS)
  return [...new Set(keys.filter((k): k is PermissionKey => valid.has(k)))]
}

/**
 * Resolves permission keys to their ids.
 *
 * The `permissions` table is reconciled against PERMISSION_KEYS by the seed,
 * so a key with no row means the seed has not run since that key was added —
 * worth failing loudly rather than silently granting less than was asked for.
 */
async function idsForKeys(keys: PermissionKey[]): Promise<string[]> {
  if (keys.length === 0) return []
  const rows = await db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(inArray(permissions.key, keys))

  if (rows.length !== keys.length) {
    const missing = keys.filter((k) => !rows.some((r) => r.key === k))
    throw new Error(`Unknown permission(s): ${missing.join(', ')}. Re-run the seed.`)
  }
  return rows.map((r) => r.id)
}

export async function createRole(
  name: string,
  permissionKeys: readonly string[],
): Promise<string> {
  const actor = await requirePermission('role.manage')

  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give the role a name.')
  if (trimmed.length > 60) throw new Error('That name is too long.')

  const keys = known(permissionKeys)
  const permissionIds = await idsForKeys(keys)

  return db.transaction(async (tx) => {
    const clash = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(inOrg(roles, actor), eq(roles.name, trimmed)))
      .limit(1)

    if (clash.length > 0) throw new DuplicateRoleError(trimmed)

    const [made] = await tx
      .insert(roles)
      .values({ orgId: actor.orgId, name: trimmed, isSystemRole: false })
      .returning({ id: roles.id })

    const roleId = made!.id

    if (permissionIds.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId, permissionId })))
    }

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'role.created',
      entityType: 'role',
      entityId: roleId,
      before: null,
      after: { name: trimmed, permissions: keys },
    })

    return roleId
  })
}

/**
 * Replaces a role's permissions wholesale.
 *
 * Replace rather than diff: the form submits the complete set it is showing,
 * and applying a difference would mean a checkbox unticked while someone
 * else was editing could silently survive.
 *
 * A system role's permissions *can* be changed — §3 says the matrix is
 * editable, and revoking `user.invite` from Manager is a legitimate thing to
 * want. What cannot change is its name or its existence, so the three
 * bundles a new org starts with are always there to fall back to.
 */
export async function setRolePermissions(
  roleId: string,
  permissionKeys: readonly string[],
): Promise<void> {
  const actor = await requirePermission('role.manage')

  const keys = known(permissionKeys)
  const permissionIds = await idsForKeys(keys)

  await db.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(and(inOrg(roles, actor), eq(roles.id, roleId)))
      .limit(1)

    if (!role) throw new Error('That role no longer exists.')

    const before = await tx
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId))

    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))
    if (permissionIds.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId, permissionId })))
    }

    // An org that can no longer administer itself is unrecoverable without
    // database access, so the last grant of role.manage cannot be removed.
    const stillAdminable = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(inOrg(roles, actor), eq(permissions.key, 'role.manage')))

    if (stillAdminable.length === 0) {
      throw new Error(
        'That would leave nobody able to manage roles. Grant it elsewhere first.',
      )
    }

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'role.permissions_changed',
      entityType: 'role',
      entityId: roleId,
      before: { name: role.name, permissions: before.map((b) => b.key).sort() },
      after: { name: role.name, permissions: keys },
    })
  })
}

export async function renameRole(roleId: string, name: string): Promise<void> {
  const actor = await requirePermission('role.manage')

  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give the role a name.')
  if (trimmed.length > 60) throw new Error('That name is too long.')

  await db.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, name: roles.name, isSystemRole: roles.isSystemRole })
      .from(roles)
      .where(and(inOrg(roles, actor), eq(roles.id, roleId)))
      .limit(1)

    if (!role) throw new Error('That role no longer exists.')
    if (role.isSystemRole) throw new SystemRoleError()

    const clash = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(inOrg(roles, actor), eq(roles.name, trimmed)))
      .limit(1)

    if (clash.length > 0 && clash[0]!.id !== roleId) throw new DuplicateRoleError(trimmed)

    await tx.update(roles).set({ name: trimmed }).where(eq(roles.id, roleId))

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'role.renamed',
      entityType: 'role',
      entityId: roleId,
      before: { name: role.name },
      after: { name: trimmed },
    })
  })
}

/**
 * Deletes a custom role.
 *
 * Refused while anyone still holds it. `user_roles` cascades on role
 * deletion, so removing a role in use would strip those people of every
 * permission at once and leave them with an account that loads and can do
 * nothing — a failure that looks like a bug in the app rather than a
 * consequence of an administrative action.
 */
export async function deleteRole(roleId: string): Promise<void> {
  const actor = await requirePermission('role.manage')

  await db.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, name: roles.name, isSystemRole: roles.isSystemRole })
      .from(roles)
      .where(and(inOrg(roles, actor), eq(roles.id, roleId)))
      .limit(1)

    if (!role) throw new Error('That role no longer exists.')
    if (role.isSystemRole) throw new SystemRoleError()

    const holders = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId))

    if (holders.length > 0) throw new RoleInUseError(holders.length)

    await tx.delete(roles).where(eq(roles.id, roleId))

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'role.deleted',
      entityType: 'role',
      entityId: roleId,
      before: { name: role.name },
      after: null,
    })
  })
}
