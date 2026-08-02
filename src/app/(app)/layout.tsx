import { redirect } from 'next/navigation'
import { MobileNav } from '@/components/shell/mobile-nav'
import { Nav, type NavItem } from '@/components/shell/nav'
import type { PaletteItem } from '@/components/shell/command-palette'
import { Rail } from '@/components/shell/rail'
import { can } from '@/lib/permissions'
import { addDays, formatTime, startOfDay } from '@/lib/time'
import { signOut } from '@/server/auth'
import { getActor } from '@/server/auth/session'
import { touchPresence } from '@/server/chat/mutations'
import { countUnread } from '@/server/chat/queries'
import { listClients } from '@/server/clients/queries'
import { listMeetingsInRange, listTeam } from '@/server/meetings/queries'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor()

  // Middleware already redirects unauthenticated traffic; this is the
  // authoritative check. Middleware decides what you see, not what you may do.
  if (!actor) redirect('/login')

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  const zone = actor.timezone
  const dayStart = startOfDay(new Date(), zone)

  const [today, team, clientList, unreadTotal] = await Promise.all([
    listMeetingsInRange(actor, dayStart, addDays(dayStart, 1, zone)),
    listTeam(actor),
    listClients(actor),
    countUnread(actor),
    // Presence. Awaited in parallel rather than fired and forgotten: a
    // floating promise in a server component can be killed when the response
    // ends, and it adds no latency here because it runs alongside the rest.
    // The once-a-minute guard lives in SQL, so this is usually a no-op write.
    touchPresence(actor),
  ])

  const clientCount = clientList.length

  const visibleToday = today.filter((m) =>
    can(actor, 'meeting.view', {
      orgId: actor.orgId,
      createdByUserId: m.createdByUserId,
      attendeeIds: m.attendeeIds,
    }),
  )

  const items: NavItem[] = [
    { href: '/home', label: 'Home' },
    {
      href: '/today',
      label: 'Today',
      count: String(visibleToday.filter((m) => m.status !== 'cancelled').length),
    },
    { href: '/calendar', label: 'Calendar' },
    { href: '/chat', label: 'Chat', count: unreadTotal > 0 ? String(unreadTotal) : '', accent: true },
    { href: '/clients', label: 'Clients', count: String(clientCount) },
  ]

  // Team is hidden from people who cannot add anyone. Hiding it is
  // presentation only — the page and its action both enforce (§3).
  if (can(actor, 'user.invite')) {
    items.push({ href: '/team', label: 'Team', count: String(team.length) })
  }

  const paletteItems: PaletteItem[] = [
    { id: 'nav-home', label: 'Home', meta: 'SCREEN', group: 'Go to', href: '/home' },
    { id: 'nav-today', label: 'Today', meta: 'SCREEN', group: 'Go to', href: '/today' },
    { id: 'nav-cal', label: 'Calendar', meta: 'SCREEN', group: 'Go to', href: '/calendar' },
    { id: 'nav-clients', label: 'Clients', meta: 'SCREEN', group: 'Go to', href: '/clients' },
    { id: 'nav-chat', label: 'Chat', meta: 'SCREEN', group: 'Go to', href: '/chat' },
    { id: 'nav-profile', label: 'Profile', meta: 'SCREEN', group: 'Go to', href: '/profile' },
    ...clientList.map((c) => ({
      id: c.id,
      label: c.companyName,
      meta: `${c.meetingCount} MTG`,
      group: 'Clients',
      href: '/clients',
    })),
    ...(can(actor, 'user.invite')
      ? [
          {
            id: 'nav-team',
            label: 'Team & permissions',
            meta: 'SCREEN',
            group: 'Go to',
            href: '/team',
          },
        ]
      : []),
    ...visibleToday.map((m) => ({
      id: m.id,
      label: m.title,
      meta: formatTime(m.startsAt, zone),
      group: 'Today',
      href: '/today',
    })),
    ...team.map((p) => ({
      id: p.id,
      label: p.fullName,
      meta: 'PERSON',
      group: 'People',
      href: can(actor, 'user.invite') ? '/team' : '/home',
    })),
  ]

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
              paletteItems={paletteItems}
              onSignOut={handleSignOut}
            />
          </div>

          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  )
}
