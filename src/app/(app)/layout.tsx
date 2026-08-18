import { AssistantPanel } from '@/components/assistant/assistant-panel'
import { MobileNav } from '@/components/shell/mobile-nav'
import { Nav, type NavItem } from '@/components/shell/nav'
import { Rail } from '@/components/shell/rail'
import { ZoneProvider } from '@/components/shell/zone-context'
import { can } from '@/lib/permissions'
import { signOut } from '@/server/auth'
import { getActor, redirectStaleSession } from '@/server/auth/session'
import { touchPresence } from '@/server/chat/mutations'
import { navCounts } from '@/server/shell/nav-counts'
import { loadPaletteItems } from './palette-action'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor()

  // Middleware already redirects unauthenticated traffic; this is the
  // authoritative check. Middleware decides what you see, not what you may do.
  //
  // Not /login: reaching here means the cookie is authentic but names a user
  // this database has never had, and middleware would send an authentic
  // cookie straight back. See src/app/api/stale-session/route.ts.
  if (!actor) redirectStaleSession()

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  /**
   * Two round trips for the whole shell — the counts, and the presence write.
   *
   * This was six: today's meetings with their attendees, the team, the
   * clients with their meeting counts, and the chat conversations. All of it
   * to render four small numbers and pre-fill a palette most page views never
   * open. At ~160ms per round trip that was most of a second added to every
   * navigation before the page itself had done anything.
   */
  const [counts] = await Promise.all([
    navCounts(actor),
    // Presence. Awaited in parallel rather than fired and forgotten: a
    // floating promise in a server component can be killed when the response
    // ends. The once-a-minute guard lives in SQL, so it is usually a no-op.
    touchPresence(actor),
  ])

  const items: NavItem[] = [
    { href: '/home', label: 'Home' },
    { href: '/today', label: 'Today', count: String(counts.today) },
    { href: '/calendar', label: 'Calendar' },
    {
      href: '/chat',
      label: 'Chat',
      count: counts.unread > 0 ? String(counts.unread) : '',
      accent: true,
    },
    { href: '/clients', label: 'Clients', count: String(counts.clients) },
  ]

  // Team is hidden from people who cannot add anyone. Hiding it is
  // presentation only — the page and its action both enforce (§3).
  if (can(actor, 'user.invite')) {
    items.push({ href: '/team', label: 'Team', count: String(counts.team) })
  }

  return (
    // The actor's zone, for the shell. Everything below the header already
    // receives a zone alongside the rows it renders; the rail, the clock and
    // the date stamp are handed no rows at all, so without this they fell
    // back to the browser's zone and stopped tracking the Profile setting.
    <ZoneProvider zone={actor.timezone}>
    <div className="flex h-dvh w-full overflow-hidden bg-paper text-ink">
      {/* Vertical rail on desktop; a horizontal strip under the header on
          mobile, where 56px of width is not affordable (brief §4). */}
      <div className="hidden md:flex">
        <Rail />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="md:hidden">
          <Rail orientation="horizontal" />
          {/* The 200px sidebar cannot fit below md, and without this there
              was no way to navigate on a phone at all. */}
          <MobileNav items={items.map(({ href, label }) => ({ href, label }))} />
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="hidden md:flex">
            <Nav
              items={items}
              fullName={actor.fullName}
              roleLabel={actor.roleNames[0] ?? 'Member'}
              loadPalette={loadPaletteItems}
              onSignOut={handleSignOut}
            />
          </div>

          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>

      {/* Mounted once for the whole shell rather than per screen: the
          assistant answers the same questions wherever you are, and a panel
          that unmounts on navigation would lose a half-finished plan. */}
      <AssistantPanel />
    </div>
    </ZoneProvider>
  )
}
