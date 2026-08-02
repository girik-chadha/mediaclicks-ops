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
        <div className="max-w-[1200px]">
          <ProfileForm
            fullName={actor.fullName}
            email={actor.email}
            phoneE164={actor.phoneE164}
            timezone={actor.timezone}
            roleLabel={actor.roleNames.join(' · ') || 'No role'}
            dailyDigest={actor.dailyDigest}
            digestTime={actor.digestTime}
            reminderLeadMinutes={actor.reminderLeadMinutes}
            initials={initialsOf(actor.fullName)}
          />

          <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
            <section className="min-w-0 flex-1 rounded-sm border border-rule bg-surface p-6">
              <div className="text-micro uppercase text-slate">Access</div>
              <p className="mt-2 text-body leading-[1.5] text-slate">
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

            <section className="w-full shrink-0 rounded-sm border border-rule bg-surface p-6 lg:w-[400px]">
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

              <form action={handleSignOut} className="mt-4">
                <button
                  type="submit"
                  className="h-10 w-full cursor-pointer rounded-sm border border-rule bg-surface px-4 text-body font-medium transition-colors duration-[80ms] hover:border-signal"
                >
                  Sign out
                </button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
