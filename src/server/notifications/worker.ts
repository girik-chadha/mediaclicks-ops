import 'server-only'
import { and, asc, eq, gt, isNull, lt, lte, ne, sql } from 'drizzle-orm'
import { digestAt, digestIsDue, reminderAt, reminderIsDue } from '@/lib/notifications/schedule'
import { formatRange, formatTime, startOfDay, addDays } from '@/lib/time'
import { providerLabel } from '@/lib/meetings/schema'
import { db } from '../db'
import {
  clients,
  meetingAttendees,
  meetings,
  notifications,
  users,
} from '../db/schema'
import { mailIsConfigured, sendEmail } from '../mail'

/**
 * The notification pipeline (§4.4).
 *
 * Two phases, both idempotent, exactly as the spec asks: one pass enqueues
 * rows, a separate pass drains them. Splitting them is what makes a crashed
 * worker harmless — enqueue can run twice and insert nothing the second time,
 * and drain can only ever send a row it has not already marked sent.
 *
 * The guarantee is the unique index on
 * (user_id, type, meeting_id, scheduled_for), declared NULLS NOT DISTINCT so
 * it also holds for digests, where meeting_id is null. That constraint is the
 * idempotency, not this code.
 */

export interface WorkerReport {
  remindersQueued: number
  digestsQueued: number
  sent: number
  failed: number
}

/** How far ahead to look. Comfortably beyond the longest lead time. */
const HORIZON_HOURS = 6

export async function enqueueNotifications(now = new Date()): Promise<{
  remindersQueued: number
  digestsQueued: number
}> {
  const horizon = new Date(now.getTime() + HORIZON_HOURS * 3_600_000)

  // ── Reminders ───────────────────────────────────────────────────────────
  const upcoming = await db
    .select({
      meetingId: meetings.id,
      orgId: meetings.orgId,
      startsAt: meetings.startsAt,
      userId: meetingAttendees.userId,
      lead: users.reminderLeadMinutes,
    })
    .from(meetings)
    .innerJoin(meetingAttendees, eq(meetingAttendees.meetingId, meetings.id))
    .innerJoin(users, eq(users.id, meetingAttendees.userId))
    .where(
      and(
        ne(meetings.status, 'cancelled'),
        gt(meetings.startsAt, now),
        lt(meetings.startsAt, horizon),
        isNull(users.deactivatedAt),
      ),
    )

  const reminderRows = upcoming
    .filter((row) => reminderIsDue(row.startsAt, row.lead, now))
    .map((row) => ({
      orgId: row.orgId,
      userId: row.userId,
      meetingId: row.meetingId,
      type: 'meeting_reminder' as const,
      channel: 'email' as const,
      scheduledFor: reminderAt(row.startsAt, row.lead),
    }))

  let remindersQueued = 0
  if (reminderRows.length > 0) {
    const inserted = await db
      .insert(notifications)
      .values(reminderRows)
      .onConflictDoNothing()
      .returning({ id: notifications.id })
    remindersQueued = inserted.length
  }

  // ── Daily digests ───────────────────────────────────────────────────────
  const people = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      timezone: users.timezone,
      digestTime: users.digestTime,
      dailyDigest: users.dailyDigest,
    })
    .from(users)
    .where(and(isNull(users.deactivatedAt), eq(users.dailyDigest, true)))

  const digestRows = people
    .filter((p) => digestIsDue(p.digestTime, p.timezone, now))
    .map((p) => ({
      orgId: p.orgId,
      userId: p.id,
      meetingId: null,
      type: 'daily_digest' as const,
      channel: 'email' as const,
      scheduledFor: digestAt(p.digestTime, p.timezone, now),
    }))

  let digestsQueued = 0
  if (digestRows.length > 0) {
    const inserted = await db
      .insert(notifications)
      .values(digestRows)
      .onConflictDoNothing()
      .returning({ id: notifications.id })
    digestsQueued = inserted.length
  }

  return { remindersQueued, digestsQueued }
}

export async function drainNotifications(now = new Date(), limit = 50): Promise<{
  sent: number
  failed: number
}> {
  const due = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      meetingId: notifications.meetingId,
      type: notifications.type,
      email: users.email,
      fullName: users.fullName,
      timezone: users.timezone,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(isNull(notifications.sentAt), lte(notifications.scheduledFor, now)))
    .orderBy(asc(notifications.scheduledFor))
    .limit(limit)

  if (due.length === 0) return { sent: 0, failed: 0 }

  let sent = 0
  let failed = 0

  for (const row of due) {
    try {
      const body =
        row.type === 'daily_digest'
          ? await digestBody(row.userId, row.timezone)
          : await reminderBody(row.meetingId, row.timezone)

      // Nothing to say is not a failure — an empty day means no digest, per
      // §4.4 ("skip if the user has no meetings"). Mark it done so it is not
      // reconsidered every tick.
      if (body) {
        if (!mailIsConfigured()) throw new Error('email is not configured')
        await sendEmail({ to: row.email, subject: body.subject, text: body.text })
      }

      await db
        .update(notifications)
        .set({ sentAt: new Date() })
        .where(eq(notifications.id, row.id))
      sent += 1
    } catch {
      // Left unsent so the next tick retries it. Nothing is lost, and a
      // provider outage self-heals without anyone intervening.
      failed += 1
    }
  }

  return { sent, failed }
}

async function reminderBody(
  meetingId: string | null,
  zone: string,
): Promise<{ subject: string; text: string } | null> {
  if (!meetingId) return null

  const [m] = await db
    .select({
      title: meetings.title,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      provider: meetings.conferencingProvider,
      url: meetings.conferenceUrl,
      status: meetings.status,
      clientName: clients.companyName,
    })
    .from(meetings)
    .leftJoin(clients, eq(clients.id, meetings.clientId))
    .where(eq(meetings.id, meetingId))
    .limit(1)

  // Cancelled between enqueue and send. §4.4 wants pending notifications
  // dropped when a meeting is cancelled; this is the belt to that braces.
  if (!m || m.status === 'cancelled') return null

  // Already started. Rows that could not be delivered — an outage, or email
  // simply not configured yet — are retried on every tick, so without this
  // the day email is finally switched on would begin with a burst of
  // reminders for meetings that finished last week.
  if (m.startsAt.getTime() <= Date.now()) return null

  const when = formatRange(m.startsAt, m.endsAt, zone)
  return {
    subject: `${m.title} at ${formatTime(m.startsAt, zone)}`,
    text: [
      `${m.title}`,
      when,
      m.clientName ? `Client: ${m.clientName}` : null,
      m.url ? `${providerLabel(m.provider)}: ${m.url}` : `${providerLabel(m.provider)} — no link`,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

async function digestBody(
  userId: string,
  zone: string,
): Promise<{ subject: string; text: string } | null> {
  const dayStart = startOfDay(new Date(), zone)
  const dayEnd = addDays(dayStart, 1, zone)

  const rows = await db
    .select({
      title: meetings.title,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      provider: meetings.conferencingProvider,
      url: meetings.conferenceUrl,
      clientName: clients.companyName,
    })
    .from(meetings)
    .innerJoin(meetingAttendees, eq(meetingAttendees.meetingId, meetings.id))
    .leftJoin(clients, eq(clients.id, meetings.clientId))
    .where(
      and(
        eq(meetingAttendees.userId, userId),
        ne(meetings.status, 'cancelled'),
        sql`${meetings.startsAt} >= ${dayStart} and ${meetings.startsAt} < ${dayEnd}`,
      ),
    )
    .orderBy(asc(meetings.startsAt))

  // §4.4: skip if the user has no meetings.
  if (rows.length === 0) return null

  return {
    subject: `${rows.length} meeting${rows.length === 1 ? '' : 's'} today`,
    text: rows
      .map((m) =>
        [
          formatRange(m.startsAt, m.endsAt, zone),
          m.clientName ? `${m.clientName} — ` : '',
          m.title,
          m.url ? `\n  ${m.url}` : '',
        ].join(''),
      )
      .join('\n'),
  }
}

/** Cancelling a meeting drops its pending reminders (§4.4). */
export async function cancelPendingFor(meetingId: string): Promise<void> {
  await db
    .delete(notifications)
    .where(and(eq(notifications.meetingId, meetingId), isNull(notifications.sentAt)))
}

export async function runNotifications(now = new Date()): Promise<WorkerReport> {
  const queued = await enqueueNotifications(now)
  const drained = await drainNotifications(now)
  return { ...queued, ...drained }
}
