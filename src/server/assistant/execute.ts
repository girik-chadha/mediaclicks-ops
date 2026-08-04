import 'server-only'
import type { PerformedAction, StagedAction } from '@/lib/assistant/plan'
import { meetingUpdateInput, type MeetingUpdateInput } from '@/lib/meetings/schema'
import { requireActor, type SessionActor } from '../auth/session'
import { asAgent } from '../audit/agent-context'
import { openDirectMessage, sendMessage } from '../chat/mutations'
import { db } from '../db'
import { auditLog } from '../db/schema'
import { cancelMeeting, createMeeting, updateMeeting } from '../meetings/mutations'
import { getMeeting, type MeetingRow } from '../meetings/queries'
import { unseal } from './seal'

/**
 * Performs a confirmed plan (§4.6).
 *
 * The only place in the assistant that has an effect, and it is reached only
 * by a human clicking Confirm.
 *
 * Three things are worth noticing about how little is special here:
 *
 *  - It calls updateMeeting / cancelMeeting / sendMessage — the same
 *    functions the forms call. No assistant-only write path exists, so the
 *    assistant inherits every validation, conflict rule and notification
 *    behaviour the UI has, and cannot drift from them.
 *
 *  - Permission is checked again, inside those functions, against the state
 *    of the world *now*. The check at planning time was for the model's
 *    benefit; this one is the gate. A permission revoked in the thirty
 *    seconds someone spent reading the card takes effect.
 *
 *  - The whole run is wrapped in asAgent(), so every audit row written
 *    underneath carries agent_initiated, with the human still as the actor.
 */
export async function performPlan(token: string): Promise<PerformedAction[]> {
  const actor = await requireActor()
  const actions = unseal<readonly StagedAction[]>(token, actor.id)

  return asAgent(async () => {
    const done: PerformedAction[] = []
    for (const action of actions) {
      done.push(await perform(actor, action))
    }
    return done
  })
}

async function perform(actor: SessionActor, action: StagedAction): Promise<PerformedAction> {
  try {
    switch (action.tool) {
      case 'reschedule_meeting': {
        const meeting = await require_(actor, action.input.meeting_id)
        await updateMeeting({
          ...asUpdateInput(meeting),
          startsAt: new Date(action.input.starts_at!),
          endsAt: new Date(action.input.ends_at!),
        })
        break
      }

      case 'create_meeting': {
        const clientId = action.input.client_id || null
        await createMeeting({
          title: action.input.title!,
          startsAt: new Date(action.input.starts_at!),
          endsAt: new Date(action.input.ends_at!),
          attendeeIds: action.input.attendee_ids!.split(','),
          conferencingProvider: action.input
            .provider as MeetingUpdateInput['conferencingProvider'],
          ...(action.input.url ? { conferenceUrl: action.input.url } : {}),
          ...(clientId
            ? { type: 'client' as const, clientId }
            : { type: 'internal' as const }),
        } as Parameters<typeof createMeeting>[0])
        break
      }

      case 'cancel_meeting': {
        await cancelMeeting(action.input.meeting_id!, action.input.reason || undefined)
        break
      }

      case 'reassign_meeting': {
        const meeting = await require_(actor, action.input.meeting_id)
        const from = action.input.from_user_id!
        const to = action.input.to_user_id!
        await updateMeeting({
          ...asUpdateInput(meeting),
          attendeeIds: meeting.attendeeIds.filter((id) => id !== from).concat(to),
        })
        break
      }

      case 'notify_user': {
        const channelId = await openDirectMessage(action.input.user_id!)
        await sendMessage(channelId, action.input.message!)

        // Chat messages are not audited in normal use — a DM is not an
        // administrative act. One the assistant sent is, because §4.6 wants
        // every agent action attributable, so it is recorded here rather
        // than by making every human message write a row nobody reads.
        await db.insert(auditLog).values({
          orgId: actor.orgId,
          actorUserId: actor.id,
          actorEmail: actor.email,
          action: 'chat.message_sent',
          entityType: 'channel',
          entityId: channelId,
          before: null,
          after: { to: action.input.user_id, body: action.input.message },
          agentInitiated: true,
        })
        break
      }

      // Read-only tools never reach a plan; staging only happens for writes.
      default:
        return { verb: action.verb, what: action.what, ok: false }
    }

    return { verb: action.verb, what: action.what, ok: true }
  } catch {
    // One failure does not abandon the rest: the actions in a plan are
    // independent, and stopping halfway would leave the person with no idea
    // which half happened. Each row reports its own outcome.
    return { verb: action.verb, what: action.what, ok: false }
  }
}

async function require_(actor: SessionActor, id: string | undefined): Promise<MeetingRow> {
  const meeting = id ? await getMeeting(actor, id) : null
  if (!meeting) throw new Error('That meeting no longer exists.')
  return meeting
}

/**
 * Rebuilds the full edit payload from the current row.
 *
 * updateMeeting takes the whole meeting rather than a patch, deliberately
 * (§4.1.1: one modal, prefilled). Reading the row here rather than sealing
 * it into the plan means a field someone else changed in the meantime is
 * preserved instead of being reverted to what it was when the plan was made.
 *
 * Parsed rather than cast. The stored row is wider than the input type —
 * `type: 'client'` with no provider is representable in TypeScript's view of
 * the column even though neither the form nor the CHECK constraint allows
 * it — and parsing turns "cannot happen" into a caught error instead of a
 * cast that would be wrong exactly when it mattered.
 */
function asUpdateInput(m: MeetingRow): MeetingUpdateInput {
  return meetingUpdateInput.parse({
    id: m.id,
    title: m.title,
    description: m.description ?? undefined,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    type: m.type,
    clientId: m.clientId ?? undefined,
    conferencingProvider: m.conferencingProvider,
    conferenceUrl: m.conferenceUrl ?? undefined,
    attendeeIds: m.attendeeIds,
  })
}
