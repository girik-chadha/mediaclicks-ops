import { HomeScreen } from '@/components/home/home-screen'
import { PageHeader } from '@/components/shell/page-header'
import { addDays, startOfDay, startOfWeek } from '@/lib/time'
import { getActor, redirectStaleSession } from '@/server/auth/session'
import { toMeetingDto, visibleTo } from '@/server/meetings/dto'
import { listClientsThisWeek, listRecentActivity } from '@/server/home/queries'
import { listMeetingsInRange } from '@/server/meetings/queries'
import { listPendingFor } from '@/server/assistant/approvals'
import { describeDelay } from '@/lib/notifications/describe'
import { reminderHealth } from '@/server/notifications/health'

export default async function HomePage() {
  const actor = await getActor()
  if (!actor) redirectStaleSession()

  const zone = actor.timezone
  const dayStart = startOfDay(new Date(), zone)
  const dayEnd = addDays(dayStart, 1, zone)
  const weekStart = startOfWeek(new Date(), zone)
  const weekEnd = addDays(weekStart, 7, zone)

  const [rows, activity, clientsWeek, approvals, reminders] = await Promise.all([
    listMeetingsInRange(actor, dayStart, dayEnd),
    listRecentActivity(actor, 6),
    listClientsThisWeek(actor, weekStart, weekEnd),
    // "Needs you" is derived from real rows, never invented (§5). A pending
    // approval is the most literal thing that could be in it: someone is
    // blocked until this person answers.
    listPendingFor(actor),
    reminderHealth(actor),
  ])

  const visible = visibleTo(actor, rows)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Home" />
      <div className="min-h-0 flex-1 overflow-auto">
        <HomeScreen
          meetings={visible.map((m) => toMeetingDto(actor, m))}
          activity={activity.map((a) => ({ ...a, when: a.when.toISOString() }))}
          clientsWeek={clientsWeek}
          zone={zone}
          firstName={actor.fullName.split(' ')[0] ?? actor.fullName}
          meId={actor.id}
          remindersStuck={
            reminders
              ? { count: reminders.stuck, waiting: describeDelay(reminders.oldestMinutes) }
              : null
          }
          approvals={approvals.map((a) => ({
            id: a.id,
            summary: a.summary,
            requestedByName: a.requestedByName,
          }))}
        />
      </div>
    </div>
  )
}
