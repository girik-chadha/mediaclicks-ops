import { redirect } from 'next/navigation'
import type { MeetingDto } from '@/components/calendar/types'
import { PageHeader } from '@/components/shell/page-header'
import { DayLog } from '@/components/today/day-log'
import { can } from '@/lib/permissions'
import { addDays, startOfDay } from '@/lib/time'
import { getActor } from '@/server/auth/session'
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

export default async function TodayPage() {
  const actor = await getActor()
  if (!actor) redirect('/login')

  const zone = actor.timezone
  const dayStart = startOfDay(new Date(), zone)
  const dayEnd = addDays(dayStart, 1, zone)

  const rows = await listMeetingsInRange(actor, dayStart, dayEnd)

  const visible = rows.filter((m) =>
    can(actor, 'meeting.view', {
      orgId: actor.orgId,
      createdByUserId: m.createdByUserId,
      attendeeIds: m.attendeeIds,
    }),
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Today" />
      <div className="min-h-0 flex-1 overflow-auto">
        <DayLog meetings={visible.map(toDto)} zone={zone} />
      </div>
    </div>
  )
}
