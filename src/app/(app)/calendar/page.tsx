import { CalendarView } from '@/components/calendar/calendar-view'
import { PageHeader } from '@/components/shell/page-header'
import { can } from '@/lib/permissions'
import { addDays, startOfWeek, toWallClock } from '@/lib/time'
import { getActor, redirectStaleSession } from '@/server/auth/session'
import { toMeetingDto, visibleTo } from '@/server/meetings/dto'
import {
  listClients,
  listMeetingsInRange,
  listTeam,
} from '@/server/meetings/queries'

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
  if (!actor) redirectStaleSession()

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
  const visible = visibleTo(actor, rows)

  const startWall = toWallClock(weekStart, zone)
  const endWall = toWallClock(addDays(weekStart, 6, zone), zone)
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: zone })
  const weekLabel = `${String(startWall.day).padStart(2, '0')} ${month.format(weekStart)} – ${String(endWall.day).padStart(2, '0')} ${month.format(addDays(weekStart, 6, zone))}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Calendar" />
      <CalendarView
        meetings={visible.map((m) => toMeetingDto(actor, m))}
        people={people.map((p) => ({ id: p.id, fullName: p.fullName }))}
        clients={clients.map((c) => ({
          id: c.id,
          companyName: c.companyName,
          region: c.region,
          email: c.email,
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
        prevHref={`/calendar?week=${offset - 1}`}
        nextHref={`/calendar?week=${offset + 1}`}
        todayHref="/calendar"
      />
    </div>
  )
}
