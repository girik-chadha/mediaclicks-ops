import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import type { StagedAction } from '@/lib/assistant/plan'
import { can, type Action } from '@/lib/permissions'
import { requireActor, type SessionActor } from '../auth/session'
import { asAgent } from '../audit/agent-context'
import { openDirectMessage } from '../chat/mutations'
import { db } from '../db'
import {
  approvalRequests,
  auditLog,
  messages,
  users,
  type ApprovalKind,
} from '../db/schema'
import { cancelMeeting, updateMeeting } from '../meetings/mutations'
import { getMeeting, type MeetingRow } from '../meetings/queries'
import { inOrg } from '../scope'
import { asUpdateInput } from './shape'

/**
 * Asking someone else to make a change (ADR 0008).
 *
 * Permission decides the path. If you may already move a meeting, the
 * assistant stages it and your Confirm does it. If you may not, you are not
 * refused — the request goes to someone who may, in their chat, and they
 * decide.
 *
 * The change is always executed under the authority of the person who
 * approves it, and `requirePermission` runs again at that moment as them.
 * So nobody acquires a permission by asking; they acquire a conversation.
 * That is the whole design in one sentence, and it is why this file never
 * elevates anybody.
 */

/** Who can say yes to a change on this meeting: the person who owns it. */
export function approverFor(meeting: MeetingRow, requester: SessionActor): string | null {
  const owner = meeting.createdByUserId
  // Asking yourself is not an approval flow, it is a bug upstream.
  return owner && owner !== requester.id ? owner : null
}

/**
 * Whether the requester may do this themselves.
 *
 * The same can() the tool layer calls, asked one step earlier so the planner
 * can choose a path instead of catching a refusal. It is not a second
 * authorization — the real one still runs inside requirePermission, on both
 * the direct route and the approval route.
 */
export function mayDoItThemselves(
  actor: SessionActor,
  action: Extract<Action, 'meeting.edit' | 'meeting.delete'>,
  meeting: MeetingRow,
): boolean {
  return can(actor, action, {
    orgId: actor.orgId,
    createdByUserId: meeting.createdByUserId,
    attendeeIds: meeting.attendeeIds,
  })
}

const KIND_OF: Record<string, ApprovalKind> = {
  reschedule_meeting: 'reschedule',
  cancel_meeting: 'cancel',
  reassign_meeting: 'reassign',
}

/**
 * Files the request and puts it in the approver's chat.
 *
 * The message carries no author id — `authorName` is "Assistant". That is
 * deliberate: a bot with a user row would be a member of the organisation,
 * able to be added to meetings and counted in the team, and would need
 * permissions of its own. A name with no account cannot be any of those
 * things.
 */
export async function fileApproval(
  actor: SessionActor,
  action: StagedAction,
  meeting: MeetingRow,
  approverUserId: string,
): Promise<void> {
  const kind = KIND_OF[action.tool]
  if (!kind) throw new Error('That change cannot be sent for approval.')

  const channelId = await openDirectMessage(approverUserId)

  await db.transaction(async (tx) => {
    const [request] = await tx
      .insert(approvalRequests)
      .values({
        orgId: actor.orgId,
        requestedByUserId: actor.id,
        requestedByName: actor.fullName,
        approverUserId,
        meetingId: meeting.id,
        kind,
        payload: action.input,
        summary: `${action.verb} ${action.what}`,
      })
      .returning({ id: approvalRequests.id })

    await tx.insert(messages).values({
      orgId: actor.orgId,
      channelId,
      authorUserId: null,
      authorName: 'Assistant',
      body: `${actor.fullName} would like to ${action.verb.toLowerCase()} ${action.what}.`,
      approvalRequestId: request!.id,
    })

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'approval.requested',
      entityType: 'meeting',
      entityId: meeting.id,
      before: null,
      after: { kind, summary: `${action.verb} ${action.what}`, approver: approverUserId },
      agentInitiated: true,
    })
  })
}

export interface PendingApproval {
  id: string
  summary: string
  requestedByName: string
  createdAt: Date
}

/** What is waiting on me. Drives the badge and the chat buttons. */
export async function listPendingFor(actor: SessionActor): Promise<PendingApproval[]> {
  return db
    .select({
      id: approvalRequests.id,
      summary: approvalRequests.summary,
      requestedByName: approvalRequests.requestedByName,
      createdAt: approvalRequests.createdAt,
    })
    .from(approvalRequests)
    .where(
      and(
        inOrg(approvalRequests, actor),
        eq(approvalRequests.approverUserId, actor.id),
        eq(approvalRequests.status, 'pending'),
      ),
    )
    .orderBy(desc(approvalRequests.createdAt))
}

export type Decision = 'approved' | 'denied'

/**
 * The approver's answer.
 *
 * On yes the change runs here, now, as them — which means requirePermission
 * runs as them too. If their own permission has been revoked since the
 * request arrived, the approval fails and says so, rather than executing on
 * the strength of a permission that existed yesterday.
 */
export async function decideApproval(
  requestId: string,
  decision: Decision,
  note?: string,
): Promise<{ ok: boolean; message: string }> {
  const actor = await requireActor()

  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(and(inOrg(approvalRequests, actor), eq(approvalRequests.id, requestId)))
    .limit(1)

  if (!request) return { ok: false, message: 'That request no longer exists.' }
  if (request.approverUserId !== actor.id) {
    return { ok: false, message: 'That request is not yours to decide.' }
  }
  if (request.status !== 'pending') {
    return { ok: false, message: `Already ${request.status}.` }
  }

  if (decision === 'denied') {
    await settle(actor, request.id, 'denied', note ?? null, request.meetingId)
    await tellRequester(actor, request.requestedByUserId, `${actor.fullName} said no to: ${request.summary}` + (note ? ` — ${note}` : ''))
    return { ok: true, message: 'Turned down. They have been told.' }
  }

  const meeting = await getMeeting(actor, request.meetingId)
  if (!meeting) {
    await settle(actor, request.id, 'withdrawn', 'the meeting no longer exists', request.meetingId)
    return { ok: false, message: 'That meeting no longer exists.' }
  }

  try {
    // Under the approver's authority, inside the agent scope so the audit
    // row records that the assistant carried it — with them as the actor,
    // because they are the one who decided.
    await asAgent(async () => {
      const payload = request.payload
      if (request.kind === 'cancel') {
        await cancelMeeting(meeting.id, payload.reason || undefined)
      } else if (request.kind === 'reschedule') {
        await updateMeeting({
          ...asUpdateInput(meeting),
          startsAt: new Date(payload.starts_at!),
          endsAt: new Date(payload.ends_at!),
        })
      } else {
        await updateMeeting({
          ...asUpdateInput(meeting),
          attendeeIds: meeting.attendeeIds
            .filter((id) => id !== payload.from_user_id)
            .concat(payload.to_user_id!),
        })
      }
    })
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === 'ForbiddenError'
          ? error.message
          : 'That could not be applied.',
    }
  }

  await settle(actor, request.id, 'approved', note ?? null, request.meetingId)
  await tellRequester(actor, request.requestedByUserId, `${actor.fullName} approved: ${request.summary}`)
  return { ok: true, message: 'Done. They have been told.' }
}

async function settle(
  actor: SessionActor,
  id: string,
  status: 'approved' | 'denied' | 'withdrawn',
  note: string | null,
  meetingId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(approvalRequests)
      .set({ status, decisionNote: note, decidedAt: new Date() })
      .where(eq(approvalRequests.id, id))

    await tx.insert(auditLog).values({
      orgId: actor.orgId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: `approval.${status}`,
      entityType: 'meeting',
      entityId: meetingId,
      before: null,
      after: { requestId: id, note },
      agentInitiated: true,
    })
  })
}

/** The answer goes back the way the question came — into their chat. */
async function tellRequester(
  actor: SessionActor,
  requesterId: string | null,
  body: string,
): Promise<void> {
  if (!requesterId) return
  const channelId = await openDirectMessage(requesterId)
  await db.insert(messages).values({
    orgId: actor.orgId,
    channelId,
    authorUserId: null,
    authorName: 'Assistant',
    body,
  })
}

/** Display name for the person who must decide, for the requester's card. */
export async function approverName(
  actor: SessionActor,
  userId: string,
): Promise<string> {
  const [row] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(and(inOrg(users, actor), eq(users.id, userId)))
    .limit(1)
  return row?.fullName ?? 'them'
}
