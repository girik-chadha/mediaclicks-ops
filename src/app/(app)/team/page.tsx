import { asc, eq, inArray } from 'drizzle-orm'
import { PageHeader } from '@/components/shell/page-header'
import { can } from '@/lib/permissions'
import { getActor } from '@/server/auth/session'
import { db } from '@/server/db'
import { roles, userRoles, users } from '@/server/db/schema'
import { inOrg } from '@/server/scope'
import { CreateUserForm } from './create-user-form'

export default async function TeamPage() {
  const actor = await getActor()

  // Hiding the nav link is not access control; someone can type the URL.
  // The mutation is separately gated by requirePermission in actions.ts —
  // this only decides what is worth rendering.
  if (!actor || !can(actor, 'user.invite')) {
    const firstName = actor?.fullName.split(' ')[0] ?? 'You'
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Team" />
        <div className="p-6">
          <p className="text-body text-slate">{firstName} can&rsquo;t add people to the team.</p>
        </div>
      </div>
    )
  }

  /**
   * Two queries rather than one LEFT JOIN.
   *
   * Joining roles inline returns one row per user-role pair, so anyone
   * holding two roles is listed twice and counted twice. Roles are gathered
   * separately and folded in, so a person is a person.
   */
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

  const held =
    roster.length === 0
      ? []
      : await db
          .select({ userId: userRoles.userId, name: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            inArray(
              userRoles.userId,
              roster.map((p) => p.id),
            ),
          )

  const rolesByUser = new Map<string, string[]>()
  for (const row of held) {
    rolesByUser.set(row.userId, [...(rolesByUser.get(row.userId) ?? []), row.name])
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Team" />

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <section className="rounded-sm border border-rule bg-surface p-4">
          <h2 className="text-micro uppercase text-slate">Add someone</h2>
          <div className="mt-3">
            <CreateUserForm />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-micro uppercase text-slate">
            {roster.length} {roster.length === 1 ? 'person' : 'people'}
          </h2>
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {roster.map((person) => (
              <li key={person.id} className="flex items-center gap-4 py-3">
                <span className="min-w-0 flex-1 truncate text-body">
                  {person.fullName}
                  {person.deactivatedAt && (
                    <span className="ml-2 text-micro uppercase text-slate">Deactivated</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-label text-slate">
                  {person.email}
                </span>
                <span className="text-micro uppercase text-slate">
                  {rolesByUser.get(person.id)?.join(' · ') ?? 'No role'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
