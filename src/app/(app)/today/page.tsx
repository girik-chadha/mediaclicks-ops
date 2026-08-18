import { PageHeader } from '@/components/shell/page-header'
import { DayLog } from '@/components/today/day-log'
import { addDays, startOfDay } from '@/lib/time'
import { getActor, redirectStaleSession } from '@/server/auth/session'
import { toMeetingDto, visibleTo } from '@/server/meetings/dto'
import { listMeetingsInRange } from '@/server/meetings/queries'

export default async function TodayPage() {
  const actor = await getActor()
  if (!actor) redirectStaleSession()

  const zone = actor.timezone
  const dayStart = startOfDay(new Date(), zone)
  const dayEnd = addDays(dayStart, 1, zone)

  const rows = await listMeetingsInRange(actor, dayStart, dayEnd)

  const visible = visibleTo(actor, rows)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Today" />
      <div className="min-h-0 flex-1 overflow-auto">
        <DayLog meetings={visible.map((m) => toMeetingDto(actor, m))} zone={zone} />
      </div>
    </div>
  )
}
