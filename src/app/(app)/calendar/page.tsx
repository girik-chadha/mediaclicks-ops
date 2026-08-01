import { redirect } from 'next/navigation'
import { CalendarView } from '@/components/calendar/calendar-view'
import type { MeetingDto } from '@/components/calendar/types'
import { PageHeader } from '@/components/shell/page-header'
import { can } from '@/lib/permissions'
import { addDays, startOfWeek, toWallClock } from '@/lib/time'
import { getActor } from '@/server/auth/session'
import {
  listClients,
  listMeetingsInRange,
  listTeam,
  type MeetingRow,
} from '@/server/meetings/queries'

function toDto(m: MeetingRow): MeetingDto {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt.toISOString(),
    type: m.type,
    status: m.status,
    conferencingProvider: m.conferencingProvider,
    conferenceUrl: m.conferenceUrl,
    clientName: m.clientName,
    clientPhone: m.clientPhone,
    attendees: m.attendees,
  }
}

const isoDate = (d: Date, zone: string) => {
  const w = toWallClock(d, zone)
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const actor = await getActor()
  if (!actor) redirect('/login')

  const { week } = await searchParams
  const offset = Number.parseInt(week ?? '0', 10) || 0

  const zone = actor.timezone
  const thisWeek = startOfWeek(new Date(), zone)
  const weekStart = addDays(thisWeek, offset * 7, zone)
  const weekEnd = addDays(weekStart, 7, zone)

  const [rows, people, clients] = await Promise.all([
    listMeetingsInRange(actor, weekStart, weekEnd),
    listTeam(actor),
    listClients(actor),
  ])

  /**
   * Visibility is decided by `can()` per row, not by a WHERE clause. A SQL
   * predicate encoding "mine OR I attend OR I hold meeting.view.all" would be
   * a second copy of the rule in another language, and the two would drift.
   */
  const visible = rows.filter((m) =>
    can(actor, 'meeting.view', {
      orgId: actor.orgId,
      createdByUserId: m.createdByUserId,
      attendeeIds: m.attendeeIds,
    }),
  )

  const startWall = toWallClock(weekStart, zone)
  const endWall = toWallClock(addDays(weekStart, 6, zone), zone)
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: zone })
  const weekLabel = `${String(startWall.day).padStart(2, '0')} ${month.format(weekStart)} – ${String(endWall.day).padStart(2, '0')} ${month.format(addDays(weekStart, 6, zone))}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Calendar" />
      <CalendarView
        meetings={visible.map(toDto)}
        people={people.map((p) => ({ id: p.id, fullName: p.fullName }))}
        clients={clients.map((c) => ({
          id: c.id,
          companyName: c.companyName,
          region: c.region,
        }))}
        weekStartIso={weekStart.toISOString()}
        zone={zone}
        meId={actor.id}
        defaultDate={isoDate(weekStart, zone)}
        canInviteOthers={can(actor, 'meeting.create', {
          orgId: actor.orgId,
          createdByUserId: actor.id,
          // A set containing someone else is exactly what create.any gates.
          attendeeIds: [actor.id, '00000000-0000-0000-0000-000000000000'],
        })}
        weekLabel={weekLabel}
        onPrev={`/calendar?week=${offset - 1}`}
        onNext={`/calendar?week=${offset + 1}`}
      />
    </div>
  )
}
