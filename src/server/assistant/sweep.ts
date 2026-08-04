import 'server-only'
import { and, eq, lte, or } from 'drizzle-orm'
import { db } from '../db'
import {
  approvalRequests,
  auditLog,
  channelMembers,
  channels,
  meetings,
  messages,
} from '../db/schema'

/**
 * The stale-request sweep (ADR 0008).
 *
 * Its own module, and not because approvals.ts was getting long: this runs
 * from the cron tick, which has no session, and importing it from a file
 * that reaches requireActor drags Auth.js into a code path that has no user
 * in it. Keeping the session-free work session-free is the same discipline
 * that keeps argon2 out of the Edge bundle.
 */

/**
 * Retires requests that can no longer be answered honestly (ADR 0008).
 *
 * A pending request is a question someone is waiting on. Once the meeting
 * has started or been cancelled, approving it would either do nothing or do
 * something absurd — and leaving it in the approver's chat with live
 * buttons invites exactly that. Nothing swept it before, so a request on a
 * meeting that happened last Tuesday sat there forever looking actionable.
 *
 * Runs in the notification tick, which has no session: this sweeps every
 * organisation, so it is written against the request's own org_id rather
 * than an actor's. Idempotent — a second pass finds nothing left to do.
 */
export async function sweepStaleApprovals(now = new Date()): Promise<number> {
  const stale = await db
    .select({
      id: approvalRequests.id,
      orgId: approvalRequests.orgId,
      summary: approvalRequests.summary,
      requestedByUserId: approvalRequests.requestedByUserId,
      startsAt: meetings.startsAt,
      status: meetings.status,
    })
    .from(approvalRequests)
    .innerJoin(meetings, eq(meetings.id, approvalRequests.meetingId))
    .where(
      and(
        eq(approvalRequests.status, 'pending'),
        or(eq(meetings.status, 'cancelled'), lte(meetings.startsAt, now)),
      ),
    )

  for (const row of stale) {
    const why =
      row.status === 'cancelled'
        ? 'the meeting was cancelled'
        : 'the meeting has already started'

    await db.transaction(async (tx) => {
      await tx
        .update(approvalRequests)
        .set({ status: 'withdrawn', decisionNote: why, decidedAt: now })
        .where(
          // Re-checked inside the transaction: between the read above and
          // here, the approver may have answered. Their decision wins.
          and(eq(approvalRequests.id, row.id), eq(approvalRequests.status, 'pending')),
        )

      await tx.insert(auditLog).values({
        orgId: row.orgId,
        actorUserId: null,
        actorEmail: null,
        action: 'approval.withdrawn',
        entityType: 'approval_request',
        entityId: row.id,
        before: null,
        after: { reason: why, summary: row.summary },
        agentInitiated: true,
      })

      // Tell the person who asked. Silence here means they wait forever for
      // an answer that is never coming.
      if (row.requestedByUserId) {
        const channelId = await openDirectMessageBetween(tx, row.orgId, row.requestedByUserId)
        if (channelId) {
          await tx.insert(messages).values({
            orgId: row.orgId,
            channelId,
            authorUserId: null,
            authorName: 'Assistant',
            body: `Your request lapsed — ${why}: ${row.summary}`,
          })
        }
      }
    })
  }

  return stale.length
}

/**
 * The requester's existing conversation with the assistant, if one exists.
 *
 * Deliberately does not create one. openDirectMessage() needs a session to
 * decide who the other party is, and the sweep has none; more importantly a
 * lapsed request is not worth opening a brand-new conversation for. If the
 * two have never spoken, the audit row is the record and the requester will
 * see the meeting is gone.
 */
async function openDirectMessageBetween(
  tx: Pick<typeof db, 'select'>,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
    .where(
      and(
        eq(channels.orgId, orgId),
        eq(channels.kind, 'direct'),
        eq(channelMembers.userId, userId),
      ),
    )
    .limit(1)
  return row?.id ?? null
}
