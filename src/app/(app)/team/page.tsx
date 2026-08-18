import { asc, eq, inArray } from 'drizzle-orm'
import { PageHeader } from '@/components/shell/page-header'
import { PermissionMatrix, type MatrixPerson } from '@/components/team/permission-matrix'
import { can, type PermissionKey } from '@/lib/permissions'
import { getActor } from '@/server/auth/session'
import { db } from '@/server/db'
import { permissions, rolePermissions, roles, userRoles, users } from '@/server/db/schema'
import { inOrg } from '@/server/scope'
import { RolesPanel, type RoleRow } from '@/components/team/roles-panel'
import { listRoles } from '@/server/team/roles'
import { CreateUserForm } from './create-user-form'
import {
  createRoleAction,
  deleteRoleAction,
  renameRoleAction,
  setRolePermissionsAction,
  setUserRoleAction,
} from './actions'

export default async function TeamPage() {
  const actor = await getActor()

  // Hiding the nav link is not access control; someone can type the URL.
  // Every mutation is separately gated — this decides what is worth rendering.
  if (!actor || !can(actor, 'user.invite')) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Team" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-16 text-center">
          <p className="font-display text-display-sm">This page is for owners and managers.</p>
          <p className="max-w-[420px] text-body leading-[1.5] text-slate">
            Ask an owner to change your role if you need it. Your own profile and meetings
            are unaffected.
          </p>
          <a
            href="/home"
            className="mt-2 inline-flex h-10 items-center rounded-sm border border-rule bg-surface px-4 text-body font-medium transition-colors duration-[80ms] hover:border-signal"
          >
            Back to home
          </a>
        </div>
      </div>
    )
  }

  const roster = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .where(inOrg(users, actor))
    .orderBy(asc(users.fullName))

  const ids = roster.map((p) => p.id)

  /**
   * Roles and their permissions in one pass, then folded per person.
   * Joining inline would return a row per user × role × permission and
   * multiply the roster.
   */
  const grants =
    ids.length === 0
      ? []
      : await db
          .select({
            userId: userRoles.userId,
            roleName: roles.name,
            permissionKey: permissions.key,
          })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(inArray(userRoles.userId, ids))

  const byUser = new Map<string, { role: string; keys: Set<string> }>()
  for (const g of grants) {
    const entry = byUser.get(g.userId) ?? { role: g.roleName, keys: new Set<string>() }
    entry.role = g.roleName
    if (g.permissionKey) entry.keys.add(g.permissionKey)
    byUser.set(g.userId, entry)
  }

  const ownerCount = [...byUser.values()].filter((v) => v.role === 'Owner').length

  // The org's real roles, so the assignment dropdown offers custom ones and
  // not just the three the system seeds.
  const orgRoles: RoleRow[] = await listRoles(actor.orgId)

  const people: MatrixPerson[] = roster.map((p) => {
    const entry = byUser.get(p.id)
    return {
      id: p.id,
      fullName: p.fullName,
      email: p.email,
      roleName: entry?.role ?? 'Member',
      permissions: [...(entry?.keys ?? [])] as PermissionKey[],
      deactivated: Boolean(p.deactivatedAt),
      // §3: at least one Owner must always exist, so the last one is locked.
      roleLocked: entry?.role === 'Owner' && ownerCount <= 1,
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Team &amp; permissions" />

      <div className="min-h-0 flex-1 overflow-auto">
        <PermissionMatrix
          people={people}
          roleNames={orgRoles.map((r) => r.name)}
          canManageRoles={can(actor, 'user.manage')}
          onSetRole={setUserRoleAction}
        />

        <div className="flex min-w-[760px] max-w-[1440px] flex-col gap-6 px-6 pb-8">
          {/* Only for people who may actually change them; the mutations
              check role.manage again regardless. */}
          {can(actor, 'role.manage') && (
            <RolesPanel
              roles={orgRoles}
              onCreate={createRoleAction}
              onSetPermissions={setRolePermissionsAction}
              onRename={renameRoleAction}
              onDelete={deleteRoleAction}
            />
          )}

          <section className="rounded-sm border border-rule bg-surface p-4">
            <h2 className="text-micro uppercase text-slate">Add someone</h2>
            <div className="mt-3">
              <CreateUserForm />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
