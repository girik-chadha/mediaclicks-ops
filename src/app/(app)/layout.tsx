import { redirect } from 'next/navigation'
import { Nav, type NavItem } from '@/components/shell/nav'
import { Rail } from '@/components/shell/rail'
import { can } from '@/lib/permissions'
import { signOut } from '@/server/auth'
import { getActor } from '@/server/auth/session'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor()

  // Middleware already redirects unauthenticated traffic; this is the
  // authoritative check. Middleware decides what you see, not what you may do.
  if (!actor) redirect('/login')

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  const items: NavItem[] = [
    { href: '/today', label: 'Today' },
    { href: '/calendar', label: 'Calendar' },
  ]

  // Team is hidden from people who cannot add anyone. Hiding it is
  // presentation only — the page and its action both enforce (§3).
  if (can(actor, 'user.invite')) items.push({ href: '/team', label: 'Team' })

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-paper text-ink">
      {/* Vertical rail on desktop; a horizontal strip under the header on
          mobile, where 56px of width is not affordable (brief §4). */}
      <div className="hidden md:flex">
        <Rail />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="md:hidden">
          <Rail orientation="horizontal" />
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="hidden md:flex">
            <Nav
              items={items}
              fullName={actor.fullName}
              roleLabel={actor.roleNames[0] ?? 'Member'}
              onSignOut={handleSignOut}
            />
          </div>

          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  )
}
