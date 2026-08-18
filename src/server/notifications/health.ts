import 'server-only'
import { and, isNull, lt, sql } from 'drizzle-orm'
import type { SessionActor } from '../auth/session'
import { db } from '../db'
import { notifications } from '../db/schema'
import { inOrg } from '../scope'

/**
 * Whether reminders are actually going out.
 *
 * The worker runs from outside the app — a cron service posting to
 * /api/cron/notifications. If nobody configures that, or the secret is
 * wrong, or the schedule is deleted, nothing throws and no page changes.
 * Rows queue up and are never drained, and the first anyone hears of it is
 * a person missing a meeting.
 *
 * That is the failure this exists to make visible. It invents nothing:
 * a notification whose scheduled_for has passed and whose sent_at is still
 * null means either the worker is not running or it cannot deliver. Both
 * are worth saying out loud.
 *
 * Read straight from the rows the worker itself writes, so there is no
 * separate heartbeat to keep in sync with reality — the evidence is the
 * work not being done.
 */

/** Below this, a late tick is just a late tick. */
const GRACE_MINUTES = 20

export interface ReminderHealth {
  /** Overdue and undelivered. */
  readonly stuck: number
  /** How long the oldest has been waiting, in minutes. */
  readonly oldestMinutes: number
}

export async function reminderHealth(actor: SessionActor): Promise<ReminderHealth | null> {
  const cutoff = new Date(Date.now() - GRACE_MINUTES * 60_000)

  const [row] = await db
    .select({
      stuck: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${notifications.scheduledFor})`,
    })
    .from(notifications)
    .where(
      and(
        inOrg(notifications, actor),
        isNull(notifications.sentAt),
        lt(notifications.scheduledFor, cutoff),
      ),
    )

  if (!row || row.stuck === 0 || !row.oldest) return null

  return {
    stuck: row.stuck,
    oldestMinutes: Math.floor((Date.now() - new Date(row.oldest).getTime()) / 60_000),
  }
}

