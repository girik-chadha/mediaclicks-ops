import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/shell/page-header'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { signOut } from '@/server/auth'
import { getActor } from '@/server/auth/session'
import { ProfileForm } from './profile-form'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

export default async function ProfilePage() {
  const actor = await getActor()
  if (!actor) redirect('/login')

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  const held = PERMISSION_KEYS.filter((k) => actor.permissions.has(k))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Profile" />

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="flex max-w-[1200px] flex-col gap-6 lg:flex-row lg:items-start">
          <section className="min-w-0 flex-1 rounded-sm border border-rule bg-surface p-6">
            <div className="text-micro uppercase text-slate">Profile</div>

            <div className="mt-4 flex items-center gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-invert text-body font-semibold text-invert-fg">
                {initialsOf(actor.fullName)}
              </span>
              <div className="min-w-0">
                <div className="truncate font-display text-display-sm">{actor.fullName}</div>
                <div className="truncate text-label text-slate">{actor.email}</div>
              </div>
            </div>

            <div className="mt-6">
              <ProfileForm
                fullName={actor.fullName}
                phoneE164={actor.phoneE164}
                timezone={actor.timezone}
              />
            </div>
          </section>

          <aside className="w-full shrink-0 lg:w-[360px]">
            <section className="rounded-sm border border-rule bg-surface p-6">
              <div className="text-micro uppercase text-slate">Access</div>

              <div className="mt-3 flex gap-3 border-b border-rule py-1.5">
                <span className="w-24 shrink-0 pt-0.5 text-micro uppercase text-slate">
                  Role
                </span>
                <span className="min-w-0 flex-1 text-body">
                  {actor.roleNames.join(' · ') || 'No role'}
                </span>
              </div>
              <div className="flex gap-3 border-b border-rule py-1.5">
                <span className="w-24 shrink-0 pt-0.5 text-micro uppercase text-slate">
                  Email
                </span>
                <span className="min-w-0 flex-1 truncate text-body">{actor.email}</span>
              </div>

              {/* §8's voice: say what is true. The matrix is the owner's
                  surface; this is just what you personally hold. */}
              <p className="mt-4 text-label text-slate">
                {held.length} of {PERMISSION_KEYS.length} permissions, granted through your
                role. Only an owner can change these.
              </p>

              <ul className="mt-3 flex flex-wrap gap-1.5">
                {held.map((key) => (
                  <li
                    key={key}
                    className="rounded-sm border border-rule px-1.5 py-0.5 font-mono text-[0.625rem] tracking-[-0.02em] text-slate"
                  >
                    {key}
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-4 rounded-sm border border-rule bg-surface p-6">
              <div className="text-micro uppercase text-slate">Password</div>
              <p className="mt-2 text-body leading-[1.5] text-slate">
                Changing your password is a command-line step for now:
              </p>
              <code className="mt-2 block overflow-x-auto rounded-sm border border-rule bg-paper p-2 font-mono text-[0.6875rem] tracking-[-0.02em]">
                npm run db:set-password -- {actor.email}
              </code>
              <p className="mt-2 text-label text-slate">
                Existing sessions stay signed in — they are tokens, not database records.
              </p>
            </section>

            <form action={handleSignOut} className="mt-4">
              <button
                type="submit"
                className="h-10 w-full cursor-pointer rounded-sm border border-rule bg-surface px-4 text-body font-medium transition-colors duration-[80ms] hover:border-signal"
              >
                Sign out
              </button>
            </form>
          </aside>
        </div>
      </div>
    </div>
  )
}
