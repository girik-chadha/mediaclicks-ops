import { asc, eq } from 'drizzle-orm'
import { TodayStamp } from '@/components/shell/today-stamp'
import { can } from '@/lib/permissions'
import { getActor } from '@/server/auth/session'
import { db } from '@/server/db'
import { roles, userRoles, users } from '@/server/db/schema'
import { CreateUserForm } from './create-user-form'

export default async function TeamPage() {
  const actor = await getActor()

  // Hiding the nav link is not access control; someone can type the URL.
  // The mutation is separately gated by requirePermission in actions.ts —
  // this only decides what is worth rendering.
  if (!actor || !can(actor, 'user.invite')) {
    const firstName = actor?.fullName.split(' ')[0] ?? 'You'
    return (
      <div className="p-6">
        <p className="text-body text-slate">{firstName} can&rsquo;t add people to the team.</p>
      </div>
    )
  }

  const roster = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      deactivatedAt: users.deactivatedAt,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(users.orgId, actor.orgId))
    .orderBy(asc(users.fullName))

  return (
    <div>
      <header className="flex h-12 items-center justify-between border-b border-rule bg-surface px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-title">Team</h1>
          <TodayStamp />
        </div>
      </header>

      <div className="p-6">
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
              <li key={`${person.id}-${person.roleName ?? 'none'}`} className="flex items-center gap-4 py-3">
                <span className="min-w-0 flex-1 truncate text-body">
                  {person.fullName}
                  {person.deactivatedAt && (
                    <span className="ml-2 text-micro uppercase text-slate">Deactivated</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-label text-slate">{person.email}</span>
                <span className="text-micro uppercase text-slate">{person.roleName ?? 'No role'}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
