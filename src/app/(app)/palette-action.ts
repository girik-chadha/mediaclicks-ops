'use server'

import type { PaletteItem } from '@/components/shell/command-palette'
import { can } from '@/lib/permissions'
import { formatTime } from '@/lib/time'
import { requireActor } from '@/server/auth/session'
import { listClients } from '@/server/clients/queries'
import { listMeetingsInRange, listTeam } from '@/server/meetings/queries'
import { addDays, startOfDay } from '@/lib/time'

/**
 * Builds the ⌘K palette on first open, rather than on every page load.
 *
 * The layout used to fetch every client, every teammate and today's meetings
 * on every navigation so the palette would be ready. Most page views never
 * open it, so that was several round trips spent on nothing. Loading it when
 * it is asked for costs one wait, once, on a keystroke that already implies
 * the person is about to read a list.
 */
export async function loadPaletteItems(): Promise<PaletteItem[]> {
  const actor = await requireActor()
  const zone = actor.timezone
  const dayStart = startOfDay(new Date(), zone)
  const canManageTeam = can(actor, 'user.invite')

  const [meetings, team, clients] = await Promise.all([
    listMeetingsInRange(actor, dayStart, addDays(dayStart, 1, zone)),
    listTeam(actor),
    listClients(actor),
  ])

  const screens: PaletteItem[] = [
    { id: 'nav-home', label: 'Home', meta: 'SCREEN', group: 'Go to', href: '/home' },
    { id: 'nav-today', label: 'Today', meta: 'SCREEN', group: 'Go to', href: '/today' },
    { id: 'nav-cal', label: 'Calendar', meta: 'SCREEN', group: 'Go to', href: '/calendar' },
    { id: 'nav-chat', label: 'Chat', meta: 'SCREEN', group: 'Go to', href: '/chat' },
    { id: 'nav-clients', label: 'Clients', meta: 'SCREEN', group: 'Go to', href: '/clients' },
    { id: 'nav-profile', label: 'Profile', meta: 'SCREEN', group: 'Go to', href: '/profile' },
    ...(canManageTeam
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
  ]

  const visible = meetings.filter((m) =>
    can(actor, 'meeting.view', {
      orgId: actor.orgId,
      createdByUserId: m.createdByUserId,
      attendeeIds: m.attendeeIds,
    }),
  )

  return [
    ...screens,
    ...visible.map((m) => ({
      id: m.id,
      label: m.title,
      meta: formatTime(m.startsAt, zone),
      group: 'Today',
      href: '/today',
    })),
    ...clients.map((c) => ({
      id: c.id,
      label: c.companyName,
      meta: `${c.meetingCount} MTG`,
      group: 'Clients',
      href: '/clients',
    })),
    ...team.map((p) => ({
      id: p.id,
      label: p.fullName,
      meta: 'PERSON',
      group: 'People',
      href: canManageTeam ? '/team' : '/home',
    })),
  ]
}
