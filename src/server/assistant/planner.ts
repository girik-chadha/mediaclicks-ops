import 'server-only'
import { EXAMPLES, parse, type Intent, type MeetingRef } from '@/lib/assistant/parse'
import type { AssistantReply, StagedAction } from '@/lib/assistant/plan'
import { resolveRange, resolveWhen } from '@/lib/assistant/when'
import { generatesLink } from '@/lib/meetings/schema'
import { can } from '@/lib/permissions'
import { formatRange, formatTime } from '@/lib/time'
import type { SessionActor } from '../auth/session'
import {
  listClients,
  listMeetingsInRange,
  listTeam,
  type MeetingRow,
} from '../meetings/queries'
import { runTool } from './tools'

/**
 * The planner: a sentence in, a proposal out.
 *
 * This is the half of §4.6 that a language model used to do, and it is the
 * only half that changed. Everything downstream — the tool layer, the
 * permission check, the confirmation card, the signed plan, the ambient
 * audit flag — is untouched, because the seam is `AssistantReply` and not
 * anything model-shaped.
 *
 * Writes still go through runTool(), never around it. That is deliberate:
 * it would be easy to call updateMeeting directly from here and save a
 * layer, and doing so would quietly move authorization out of the one place
 * that is guaranteed to run it.
 *
 * What this trades away is breadth. It understands a listed set of
 * phrasings and says so when it does not understand, rather than guessing
 * at which meeting someone meant and staging a cancellation against it. For
 * an internal tool where the alternative is a per-request bill, narrow and
 * honest beats broad and approximate.
 */

/** How far around today to look when matching a meeting by title. */
const LOOKBACK_DAYS = 7
const LOOKAHEAD_DAYS = 60

export async function planFromPrompt(
  actor: SessionActor,
  prompt: string,
): Promise<AssistantReply> {
  const parsed = parse(prompt)
  if (!parsed.ok) return { answer: withExamples(parsed.reason), actions: [] }

  const now = new Date()

  switch (parsed.intent.kind) {
    case 'schedule':
      return await stageSchedule(actor, parsed.intent, now)
    case 'list':
      return await answerList(actor, parsed.intent, now)
    case 'free':
      return await answerFree(actor, parsed.intent, now)
    case 'move':
      return await stageMove(actor, parsed.intent, now)
    case 'cancel':
      return await stageCancel(actor, parsed.intent, now)
    case 'reassign':
      return await stageReassign(actor, parsed.intent, now)
    case 'notify':
      return await stageNotify(actor, parsed.intent)
  }
}

const withExamples = (reason: string) =>
  `${reason}\n\n${EXAMPLES.map((e) => `· ${e}`).join('\n')}`

const plain = (answer: string): AssistantReply => ({ answer, actions: [] })

/* ── Answering ────────────────────────────────────────────────────────── */

async function answerList(
  actor: SessionActor,
  intent: Extract<Intent, { kind: 'list' }>,
  now: Date,
): Promise<AssistantReply> {
  const { from, to } = resolveRange(intent.range, now, actor.timezone)
  const meetings = (await visibleBetween(actor, from, to)).filter((m) => m.status !== 'cancelled')

  const when = RANGE_WORDS[intent.range]

  if (meetings.length === 0) return plain(`Nothing scheduled ${when}.`)

  const lines = meetings.map(
    (m) =>
      `· ${formatRange(m.startsAt, m.endsAt, actor.timezone)}  ${m.title}` +
      (m.clientName ? ` — ${m.clientName}` : ''),
  )

  return plain(
    `${meetings.length} meeting${meetings.length === 1 ? '' : 's'} ${when}.\n\n${lines.join('\n')}`,
  )
}

const RANGE_WORDS = {
  today: 'today',
  tomorrow: 'tomorrow',
  'this-week': 'this week',
  'next-week': 'next week',
} as const

async function answerFree(
  actor: SessionActor,
  intent: Extract<Intent, { kind: 'free' }>,
  now: Date,
): Promise<AssistantReply> {
  const team = await listTeam(actor)
  const userIds = intent.withWholeTeam ? team.map((p) => p.id) : [actor.id]

  // A named range becomes a search horizon; "next week" means look far
  // enough ahead to reach it.
  let withinDays = 7
  if (intent.range) {
    const { to } = resolveRange(intent.range, now, actor.timezone)
    withinDays = Math.max(1, Math.ceil((to.getTime() - now.getTime()) / 86_400_000))
  }

  const outcome = await runTool(actor, 'find_free_slot', {
    user_ids: userIds,
    duration_minutes: intent.durationMinutes,
    within_days: withinDays,
  })

  if (outcome.isError) return plain(outcome.content)

  // The tool's output is written for a model — ISO timestamps first so it
  // can pass them straight back. A person needs the readable half.
  const slots = outcome.content
    .split('\n')
    .filter((line) => line.includes('T') && !line.startsWith('Note:'))
    .map((line) => line.split(/\s{2,}/)[1] ?? line)
    .slice(0, 5)

  if (slots.length === 0) return plain(outcome.content)

  const who = intent.withWholeTeam ? 'everyone' : 'you'
  return plain(
    `${intent.durationMinutes} minutes with ${who} free:\n\n${slots.map((s) => `· ${s}`).join('\n')}` +
      '\n\nI can\'t book a new meeting yet — use New meeting for that.',
  )
}

/* ── Staging ──────────────────────────────────────────────────────────── */

/**
 * Booking something new (§4.1.1).
 *
 * The one intent that asks questions back. A move or a cancel names a
 * meeting that already exists, so everything about it is known; a create
 * has to invent the whole row, and the two fields nobody says out loud —
 * which platform, and the join link for the ones that need one — are
 * exactly the two that make the meeting useless if guessed. So they are
 * asked for, not defaulted.
 */
async function stageSchedule(
  actor: SessionActor,
  intent: Extract<Intent, { kind: 'schedule' }>,
  now: Date,
): Promise<AssistantReply> {
  const clients = await listClients(actor)
  const team = await listTeam(actor)

  const attendeeIds = new Set<string>([actor.id])
  let client: { id: string; companyName: string } | null = null

  for (const name of intent.withNames) {
    const needle = name.toLowerCase()

    const matchedClient = clients.filter((c) => c.companyName.toLowerCase().includes(needle))
    if (matchedClient.length === 1) {
      if (client && client.id !== matchedClient[0]!.id) {
        return plain('A meeting can only have one client on it.')
      }
      client = matchedClient[0]!
      continue
    }
    if (matchedClient.length > 1) {
      return plain(
        `${matchedClient.length} clients match “${name}”: ${matchedClient.map((c) => c.companyName).join(', ')}. Which one?`,
      )
    }

    const person = await resolvePerson(actor, name)
    if (!person.ok) {
      return plain(
        `I can't find a client or a teammate called “${name}”. ` +
          (clients.length > 0
            ? `Clients on file: ${clients.map((c) => c.companyName).join(', ')}.`
            : 'There are no clients on file yet.'),
      )
    }
    attendeeIds.add(person.person.id)
  }

  // Platform. §4.1.1 offers three for a client meeting and never defaults,
  // because a WhatsApp call and a Zoom link reach the client differently.
  let provider = intent.provider
  if (!provider) {
    if (client) {
      return plain(
        `Which platform for the ${client.companyName} call — WhatsApp, Google Meet, or Zoom? ` +
          'Say it and I\'ll set it up.',
      )
    }
    provider = 'none'
  }

  // Meet and Zoom are link-based and nothing here generates one (§4.2).
  if (generatesLink(provider) && !intent.url) {
    return plain(
      `Create the ${provider === 'zoom' ? 'Zoom' : 'Google Meet'} yourself and paste the link into the message — ` +
        'nothing here can make one, and a calendar entry with no way to join is worse than none.',
    )
  }

  const startsAt = resolveWhen(intent.when, now, now, actor.timezone)
  const endsAt = new Date(startsAt.getTime() + intent.durationMinutes * 60_000)

  if (startsAt.getTime() < now.getTime()) {
    return plain(
      `That lands in the past — ${formatRange(startsAt, endsAt, actor.timezone)}. Name a day as well as a time.`,
    )
  }

  const title =
    intent.title ||
    (client
      ? `${client.companyName} call`
      : `Call with ${[...attendeeIds]
          .filter((id) => id !== actor.id)
          .map((id) => team.find((p) => p.id === id)?.fullName?.split(' ')[0] ?? 'the team')
          .join(', ')}`)

  return stage(
    await runTool(actor, 'create_meeting', {
      title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      attendee_ids: [...attendeeIds],
      client_id: client?.id ?? '',
      provider,
      url: intent.url,
    }),
    `${title} on ${formatRange(startsAt, endsAt, actor.timezone)}.` +
      (client ? ` ${client.companyName} gets an email once you confirm.` : ''),
  )
}

async function stageMove(
  actor: SessionActor,
  intent: Extract<Intent, { kind: 'move' }>,
  now: Date,
): Promise<AssistantReply> {
  const found = await resolveRef(actor, intent.ref, now)
  if (!found.ok) return plain(found.reason)

  const meeting = found.meeting
  const startsAt = resolveWhen(intent.when, meeting.startsAt, now, actor.timezone)
  const endsAt = new Date(
    startsAt.getTime() + (meeting.endsAt.getTime() - meeting.startsAt.getTime()),
  )

  if (startsAt.getTime() < now.getTime()) {
    return plain(
      `That would put ${meeting.title} in the past — ${formatRange(startsAt, endsAt, actor.timezone)}. Name a day as well as a time.`,
    )
  }

  return stage(
    await runTool(actor, 'reschedule_meeting', {
      meeting_id: meeting.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    }),
    `${meeting.title} moves to ${formatRange(startsAt, endsAt, actor.timezone)}. Everyone on it gets told once you confirm.`,
  )
}

async function stageCancel(
  actor: SessionActor,
  intent: Extract<Intent, { kind: 'cancel' }>,
  now: Date,
): Promise<AssistantReply> {
  const found = await resolveRef(actor, intent.ref, now)
  if (!found.ok) return plain(found.reason)

  return stage(
    await runTool(actor, 'cancel_meeting', {
      meeting_id: found.meeting.id,
      reason: intent.reason,
    }),
    `${found.meeting.title} on ${formatTime(found.meeting.startsAt, actor.timezone)} would be cancelled, and its pending reminders dropped.`,
  )
}

async function stageReassign(
  actor: SessionActor,
  intent: Extract<Intent, { kind: 'reassign' }>,
  now: Date,
): Promise<AssistantReply> {
  const found = await resolveRef(actor, intent.ref, now)
  if (!found.ok) return plain(found.reason)

  const leaving = await resolvePerson(actor, intent.fromName)
  if (!leaving.ok) return plain(leaving.reason)

  const joining = await resolvePerson(actor, intent.toName)
  if (!joining.ok) return plain(joining.reason)

  return stage(
    await runTool(actor, 'reassign_meeting', {
      meeting_id: found.meeting.id,
      from_user_id: leaving.person.id,
      to_user_id: joining.person.id,
    }),
    `${joining.person.fullName} would take ${leaving.person.fullName}'s place on ${found.meeting.title}.`,
  )
}

async function stageNotify(
  actor: SessionActor,
  intent: Extract<Intent, { kind: 'notify' }>,
): Promise<AssistantReply> {
  const target = await resolvePerson(actor, intent.toName)
  if (!target.ok) return plain(target.reason)

  return stage(
    await runTool(actor, 'notify_user', {
      user_id: target.person.id,
      message: sentence(intent.message),
    }),
    `${target.person.fullName} gets this in chat, from you, once you confirm.`,
  )
}

/** A staged tool outcome becomes a reply; a refused one becomes its reason. */
function stage(
  outcome: { content: string; isError?: boolean; staged?: StagedAction },
  answer: string,
): AssistantReply {
  if (outcome.isError || !outcome.staged) return plain(outcome.content)
  return { answer, actions: [outcome.staged] }
}

/* ── Resolving what they named ────────────────────────────────────────── */

type Found<T> = { ok: true } & T | { ok: false; reason: string }

async function resolveRef(
  actor: SessionActor,
  ref: MeetingRef,
  now: Date,
): Promise<Found<{ meeting: MeetingRow }>> {
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
  const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000)
  const all = (await visibleBetween(actor, from, to)).filter((m) => m.status !== 'cancelled')

  if (ref.kind === 'next') {
    const upcoming = all
      .filter((m) => m.startsAt.getTime() > now.getTime())
      .filter((m) => (ref.clientOnly ? m.type === 'client' : true))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

    const next = upcoming[0]
    if (!next) {
      return {
        ok: false,
        reason: ref.clientOnly
          ? 'You have no client meetings coming up.'
          : 'You have nothing coming up.',
      }
    }
    return { ok: true, meeting: next }
  }

  const needle = ref.text.toLowerCase()
  const matches = all.filter((m) => m.title.toLowerCase().includes(needle))

  if (matches.length === 0) {
    return { ok: false, reason: `I can't find a meeting called “${ref.text}”.` }
  }

  if (matches.length > 1) {
    // Never pick one. Guessing here means cancelling the wrong meeting, and
    // the confirmation card would show a plausible-looking wrong answer.
    const options = matches
      .slice(0, 5)
      .map((m) => `· ${m.title} — ${formatRange(m.startsAt, m.endsAt, actor.timezone)}`)
      .join('\n')
    return {
      ok: false,
      reason: `${matches.length} meetings match “${ref.text}”. Which one?\n\n${options}`,
    }
  }

  return { ok: true, meeting: matches[0]! }
}

async function resolvePerson(
  actor: SessionActor,
  name: string,
): Promise<Found<{ person: { id: string; fullName: string } }>> {
  const team = await listTeam(actor)
  const needle = name.toLowerCase().trim()

  if (/^(?:me|myself|i)$/.test(needle)) {
    return { ok: true, person: { id: actor.id, fullName: actor.fullName } }
  }

  // First name first: it is what people type, and an exact first-name hit
  // should beat a loose substring match elsewhere in someone else's name.
  const byFirst = team.filter((p) => p.fullName.toLowerCase().split(/\s+/)[0] === needle)
  const matches = byFirst.length > 0 ? byFirst : team.filter((p) => p.fullName.toLowerCase().includes(needle))

  if (matches.length === 0) return { ok: false, reason: `Nobody on the team is called ${name}.` }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `${matches.length} people match “${name}”: ${matches.map((p) => p.fullName).join(', ')}. Which one?`,
    }
  }

  return { ok: true, person: matches[0]! }
}

async function visibleBetween(
  actor: SessionActor,
  from: Date,
  to: Date,
): Promise<MeetingRow[]> {
  const rows = await listMeetingsInRange(actor, from, to)
  return rows.filter((m) =>
    can(actor, 'meeting.view', {
      orgId: actor.orgId,
      createdByUserId: m.createdByUserId,
      attendeeIds: m.attendeeIds,
    }),
  )
}

/** Capitalised, full stop, so a chat message does not arrive as a fragment. */
function sentence(text: string): string {
  const trimmed = text.trim()
  const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}
