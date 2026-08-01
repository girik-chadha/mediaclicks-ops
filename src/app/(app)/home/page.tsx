import { redirect } from 'next/navigation'
import type { MeetingDto } from '@/components/calendar/types'
import { HomeScreen } from '@/components/home/home-screen'
import { PageHeader } from '@/components/shell/page-header'
import { can } from '@/lib/permissions'
import { addDays, startOfDay, startOfWeek } from '@/lib/time'
import { getActor } from '@/server/auth/session'
import { listClientsThisWeek, listRecentActivity } from '@/server/home/queries'
import { listMeetingsInRange, type MeetingRow } from '@/server/meetings/queries'

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

export default async function HomePage() {
  const actor = await getActor()
  if (!actor) redirect('/login')

  const zone = actor.timezone
  const dayStart = startOfDay(new Date(), zone)
  const dayEnd = addDays(dayStart, 1, zone)
  const weekStart = startOfWeek(new Date(), zone)
  const weekEnd = addDays(weekStart, 7, zone)

  const [rows, activity, clientsWeek] = await Promise.all([
    listMeetingsInRange(actor, dayStart, dayEnd),
    listRecentActivity(actor, 6),
    listClientsThisWeek(actor, weekStart, weekEnd),
  ])

  const visible = rows.filter((m) =>
    can(actor, 'meeting.view', {
      orgId: actor.orgId,
      createdByUserId: m.createdByUserId,
      attendeeIds: m.attendeeIds,
    }),
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Home" />
      <div className="min-h-0 flex-1 overflow-auto">
        <HomeScreen
          meetings={visible.map(toDto)}
          activity={activity.map((a) => ({ ...a, when: a.when.toISOString() }))}
          clientsWeek={clientsWeek}
          zone={zone}
          firstName={actor.fullName.split(' ')[0] ?? actor.fullName}
          meId={actor.id}
        />
      </div>
    </div>
  )
}
