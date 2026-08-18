import 'server-only'
import { findFreeSlots } from '@/lib/assistant/free-slots'
import type { StagedAction } from '@/lib/assistant/plan'
import { toolSpec } from '@/lib/assistant/tools'
import { whenLabel } from '@/lib/assistant/format'
import { meetingInput } from '@/lib/meetings/schema'
import { can } from '@/lib/permissions'
import { formatRange } from '@/lib/time'
import type { SessionActor } from '../auth/session'
import { requirePermission } from '../auth/require'
import {
  getMeeting,
  listClients,
  listMeetingsInRange,
  listTeam,
  listVisibleMeetings,
  type MeetingRow,
} from '../meetings/queries'

/**
 * The tool layer (§4.6).
 *
 * Two rules hold for every tool here, and they are the whole point of the
 * feature:
 *
 *  1. Authorization goes through requirePermission() — the same function the
 *     buttons use. There is no assistant-specific permission path, so "the
 *     agent cannot exceed the user" is structural rather than remembered.
 *     A refusal is handed *back to the model* as a tool error, so it can say
 *     "you can't move Priya's meeting, ask her" instead of failing opaquely.
 *
 *  2. Nothing with a side effect runs here. Write tools resolve their
 *     arguments, check permission, and return a description of what *would*
 *     happen. The model cannot cancel a meeting by calling a tool; only a
 *     human clicking Confirm can (see execute.ts).
 */

export interface ToolOutcome {
  /** Goes back to the model verbatim as the tool_result. */
  readonly content: string
  readonly isError?: boolean
  /** Set by write tools that staged successfully. */
  readonly staged?: StagedAction
}

const fail = (content: string): ToolOutcome => ({ content, isError: true })

export async function runTool(
  actor: SessionActor,
  name: string,
  rawInput: unknown,
): Promise<ToolOutcome> {
  const spec = toolSpec(name)
  if (!spec) return fail(`There is no tool called ${name}.`)

  const input = (rawInput ?? {}) as Record<string, unknown>

  try {
    switch (spec.name) {
      case 'list_team':
        return await doListTeam(actor)
      case 'list_clients':
        return await doListClients(actor)
      case 'create_meeting':
        return await stageCreate(actor, input)
      case 'list_my_meetings':
        return await doListMeetings(actor, input)
      case 'find_free_slot':
        return await doFindFreeSlot(actor, input)
      case 'reschedule_meeting':
        return await stageReschedule(actor, input)
      case 'cancel_meeting':
        return await stageCancel(actor, input)
      case 'reassign_meeting':
        return await stageReassign(actor, input)
      case 'notify_user':
        return await stageNotify(actor, input)

      // Staged by the planner, not reachable through runTool. It carries no
      // permission of its own because asking has no effect — the check
      // happens when the approver answers, against the approver (ADR 0008).
      case 'request_approval':
        return fail('An approval request is built by the planner, not called directly.')
    }
  } catch (error) {
    // ForbiddenError's message is already written for a person ("Emma can't
    // edit other people's meetings"), so it is exactly what the model should
    // relay. Anything else is reported without internals.
    const message =
      error instanceof Error && error.name === 'ForbiddenError'
        ? error.message
        : 'That did not work. Nothing was changed.'
    return fail(message)
  }
}

/* ── Reading ──────────────────────────────────────────────────────────── */

async function doListTeam(actor: SessionActor): Promise<ToolOutcome> {
  const team = await listTeam(actor)
  if (team.length === 0) return { content: 'No one else is on the team yet.' }
  return {
    content: team
      .map((p) => `${p.id}  ${p.fullName}${p.id === actor.id ? ' (this is you)' : ''}`)
      .join('\n'),
  }
}

async function doListClients(actor: SessionActor): Promise<ToolOutcome> {
  const rows = await listClients(actor)
  if (rows.length === 0) return { content: 'No clients on file yet.' }
  return { content: rows.map((c) => `${c.id}  ${c.companyName}`).join('\n') }
}

/**
 * Stages a new meeting (§4.1.1).
 *
 * The only write tool whose subject is not an existing row: at creation the
 * thing being judged is the *proposed attendee set*, which is exactly what
 * OWNS['meeting.create'] inspects. Someone with only meeting.create.own can
 * therefore book their own time and nobody else's, through the assistant
 * for the same reason they can through the form.
 *
 * Validated with the same zod schema the modal submits, so a rule added
 * there — a new provider, a length cap — applies here without anyone
 * remembering to mirror it.
 */
async function stageCreate(
  actor: SessionActor,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const attendeeIds = parseIds(input.attendee_ids)
  if (attendeeIds.length === 0) return fail('A meeting needs at least one attendee.')

  const startsAt = parseDate(input.starts_at)
  const endsAt = parseDate(input.ends_at)
  if (!startsAt || !endsAt) return fail('starts_at and ends_at must be ISO 8601 timestamps.')

  const clientId = typeof input.client_id === 'string' && input.client_id ? input.client_id : null

  const candidate = {
    title: String(input.title ?? '').trim(),
    startsAt,
    endsAt,
    attendeeIds,
    conferencingProvider: String(input.provider ?? 'none'),
    ...(input.url ? { conferenceUrl: String(input.url) } : {}),
    ...(clientId ? { type: 'client' as const, clientId } : { type: 'internal' as const }),
  }

  const checked = meetingInput.safeParse(candidate)
  if (!checked.success) {
    // zod's message is already written for a person — it is the same text
    // the form shows under the field.
    return fail(checked.error.issues[0]?.message ?? 'That meeting is not valid.')
  }

  await requirePermission('meeting.create', {
    orgId: actor.orgId,
    createdByUserId: actor.id,
    attendeeIds,
  })

  const team = await listTeam(actor)
  const names = attendeeIds
    .map((id) => team.find((p) => p.id === id)?.fullName ?? 'someone')
    .join(', ')

  return staged({
    tool: 'create_meeting',
    input: {
      title: checked.data.title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      attendee_ids: attendeeIds.join(','),
      client_id: clientId ?? '',
      provider: checked.data.conferencingProvider,
      url: checked.data.conferenceUrl ?? '',
    },
    verb: 'Schedule',
    what: `${checked.data.title} — ${whenLabel(startsAt, endsAt, actor.timezone, new Date())}, with ${names}`,
  })
}

function visible(actor: SessionActor) {
  return (m: MeetingRow) =>
    can(actor, 'meeting.view', {
      orgId: actor.orgId,
      createdByUserId: m.createdByUserId,
      attendeeIds: m.attendeeIds,
    })
}

async function doListMeetings(
  actor: SessionActor,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const from = parseDate(input.from)
  const to = parseDate(input.to)
  if (!from || !to) return fail('from and to must both be ISO 8601 timestamps.')
  if (to.getTime() <= from.getTime()) return fail('to must be after from.')

  const rows = await listVisibleMeetings(actor, from, to, visible(actor))
  const live = rows.filter((m) => m.status !== 'cancelled')

  if (live.length === 0) {
    return { content: `Nothing scheduled between ${from.toISOString()} and ${to.toISOString()}.` }
  }

  return {
    content: live
      .map((m) =>
        [
          m.id,
          m.title,
          whenLabel(m.startsAt, m.endsAt, actor.timezone, new Date()),
          m.startsAt.toISOString(),
          m.clientName ? `client: ${m.clientName}` : 'internal',
          `with: ${m.attendees.map((a) => `${a.fullName} [${a.id}]`).join(', ')}`,
        ].join('  |  '),
      )
      .join('\n'),
  }
}

async function doFindFreeSlot(
  actor: SessionActor,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const userIds = parseIds(input.user_ids)
  const duration = parseInteger(input.duration_minutes)
  const days = parseInteger(input.within_days)

  if (userIds.length === 0) return fail('user_ids must list at least one person.')
  if (!duration || duration <= 0) return fail('duration_minutes must be a positive number.')
  if (!days || days <= 0) return fail('within_days must be a positive number.')

  const now = new Date()
  const horizon = new Date(now.getTime() + days * 86_400_000)

  // Only meetings this person may see count as busy. Stated in the result
  // rather than hidden, so the model does not present a slot as certainly
  // free when the actor cannot see the whole picture.
  const all = await listMeetingsInRange(actor, now, horizon)
  const seen = all.filter(visible(actor))
  const busy = seen.filter(
    (m) => m.status !== 'cancelled' && m.attendeeIds.some((id) => userIds.includes(id)),
  )

  const slots = findFreeSlots({
    from: now,
    withinDays: days,
    durationMinutes: duration,
    busy,
    zone: actor.timezone,
    // Two per day, so six options span three days instead of being six
    // ways of saying "Monday morning is free" — which answers a narrower
    // question than the one that was asked.
    maxPerDay: 2,
    limit: 8,
  })

  const blind = seen.length !== all.length

  if (slots.length === 0) {
    return {
      content:
        `No slot of ${duration} minutes is free for everyone in the next ${days} day(s), ` +
        'within working hours (09:00–18:00, Monday to Friday).',
    }
  }

  return {
    content:
      slots
        .map((s) => `${s.startsAt.toISOString()}  ${formatRange(s.startsAt, s.endsAt, actor.timezone)}`)
        .join('\n') +
      (blind
        ? '\n\nNote: some meetings are not visible to this user, so a slot shown as free may not be.'
        : ''),
  }
}

/* ── Staging ──────────────────────────────────────────────────────────── */

async function stageReschedule(
  actor: SessionActor,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const meeting = await load(actor, input.meeting_id)
  if (!meeting) return fail('No meeting with that id. Call list_my_meetings first.')

  const startsAt = parseDate(input.starts_at)
  const endsAt = parseDate(input.ends_at)
  if (!startsAt || !endsAt) return fail('starts_at and ends_at must be ISO 8601 timestamps.')
  if (endsAt.getTime() <= startsAt.getTime()) return fail('The meeting has to end after it starts.')

  await requirePermission('meeting.edit', subjectOf(actor, meeting))

  return staged({
    tool: 'reschedule_meeting',
    input: {
      meeting_id: meeting.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    },
    verb: 'Move',
    what: `${meeting.title} to ${whenLabel(startsAt, endsAt, actor.timezone, new Date())}`,
  })
}

async function stageCancel(
  actor: SessionActor,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const meeting = await load(actor, input.meeting_id)
  if (!meeting) return fail('No meeting with that id. Call list_my_meetings first.')
  if (meeting.status === 'cancelled') return fail('That meeting is already cancelled.')

  await requirePermission('meeting.delete', subjectOf(actor, meeting))

  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : ''

  return staged({
    tool: 'cancel_meeting',
    input: { meeting_id: meeting.id, reason },
    verb: 'Cancel',
    what:
      `${meeting.title}, ${whenLabel(meeting.startsAt, meeting.endsAt, actor.timezone, new Date())}` +
      (reason ? ` — ${reason}` : ''),
  })
}

async function stageReassign(
  actor: SessionActor,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const meeting = await load(actor, input.meeting_id)
  if (!meeting) return fail('No meeting with that id. Call list_my_meetings first.')

  const fromId = String(input.from_user_id ?? '')
  const toId = String(input.to_user_id ?? '')

  if (!meeting.attendeeIds.includes(fromId)) {
    return fail('That person is not on this meeting.')
  }
  if (meeting.attendeeIds.includes(toId)) {
    return fail('That person is already on this meeting.')
  }

  const team = await listTeam(actor)
  const replacement = team.find((p) => p.id === toId)
  if (!replacement) return fail('No one on the team has that id. Call list_team first.')

  const leaving = meeting.attendees.find((a) => a.id === fromId)

  await requirePermission('meeting.edit', subjectOf(actor, meeting))

  return staged({
    tool: 'reassign_meeting',
    input: { meeting_id: meeting.id, from_user_id: fromId, to_user_id: toId },
    verb: 'Reassign',
    what: `${meeting.title} — ${replacement.fullName} in place of ${leaving?.fullName ?? 'them'}`,
  })
}

async function stageNotify(
  actor: SessionActor,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const userId = String(input.user_id ?? '')
  const message = typeof input.message === 'string' ? input.message.trim() : ''

  if (!message) return fail('The message is empty.')
  if (userId === actor.id) return fail('Messaging yourself is not useful.')

  const team = await listTeam(actor)
  const target = team.find((p) => p.id === userId)
  if (!target) return fail('No one on the team has that id. Call list_team first.')

  return staged({
    tool: 'notify_user',
    input: { user_id: userId, message: message.slice(0, 4000) },
    verb: 'Message',
    what: `${target.fullName}: “${message}”`,
  })
}

/* ── Shared ───────────────────────────────────────────────────────────── */

/**
 * A staged action doubles as the model's tool_result. Telling the model
 * plainly that nothing has happened yet stops it reporting the change as
 * done in the sentence above the card.
 */
function staged(action: StagedAction): ToolOutcome {
  return {
    staged: action,
    content: `Staged, not yet done: ${action.verb} ${action.what}. Awaiting the user's confirmation.`,
  }
}

async function load(actor: SessionActor, id: unknown): Promise<MeetingRow | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const found = await getMeeting(actor, id)
  // Filtered by can() before the caller sees it, so a meeting the actor may
  // not view is indistinguishable from one that does not exist.
  return found && visible(actor)(found) ? found : null
}

const subjectOf = (actor: SessionActor, m: MeetingRow) => ({
  orgId: actor.orgId,
  createdByUserId: m.createdByUserId,
  attendeeIds: m.attendeeIds,
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseInteger(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) ? n : null
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && UUID.test(v))
}
