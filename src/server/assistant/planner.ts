import 'server-only'
import {
  answerIsDecline,
  answerNames,
  answerProvider,
  answerTime,
  answerUrl,
  EXAMPLES,
  parse,
  type Intent,
  type MeetingRef,
} from '@/lib/assistant/parse'
import type {
  AssistantReply,
  PendingSchedule,
  StagedAction,
} from '@/lib/assistant/plan'
import { resolveDay, resolveRange, resolveWhen } from '@/lib/assistant/when'
import { dayLabel, groupByDay, whenLabel } from '@/lib/assistant/format'
import { generatesLink } from '@/lib/meetings/schema'
import { can } from '@/lib/permissions'
import { formatRange } from '@/lib/time'
import type { SessionActor } from '../auth/session'
import {
  listClients,
  listMeetingsInRange,
  listTeam,
  type MeetingRow,
} from '../meetings/queries'
import { approverFor, approverName, mayDoItThemselves } from './approvals'
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

/**
 * Continues a request the assistant asked a question about.
 *
 * The reply carries no verb — "3pm", "zoom", a pasted URL — so it is read
 * against the slot that was asked for rather than through the matchers.
 * That is also what keeps a bare "zoom" from being mistaken for a request
 * to schedule one.
 */
export async function planFromAnswer(
  actor: SessionActor,
  pending: PendingSchedule,
  reply: string,
): Promise<AssistantReply> {
  const now = new Date()

  if (answerIsDecline(reply)) {
    return plain('Dropped it. Nothing was scheduled.')
  }

  let next: PendingSchedule = pending

  switch (pending.awaiting) {
    case 'people': {
      const names = answerNames(reply)
      if (names.length === 0) {
        return ask('I still need a name — a client, or someone on the team.', pending)
      }
      next = { ...pending, withNames: names }
      break
    }
    case 'time': {
      const when = answerTime(reply)
      if (!when?.time) {
        return ask('I need a time — "tomorrow at 3pm", "Friday at 10am".', pending)
      }
      next = {
        ...pending,
        dayIso: when.day ? resolveDay(when.day, now, actor.timezone).toISOString() : pending.dayIso,
        hour: when.time.hour,
        minute: when.time.minute,
      }
      break
    }
    case 'provider': {
      const provider = answerProvider(reply)
      if (!provider) {
        return ask('WhatsApp, Google Meet, or Zoom?', pending)
      }
      next = { ...pending, provider }
      break
    }
    case 'link': {
      const url = answerUrl(reply)
      if (!url) {
        return ask(
          'That does not look like a link. Paste the full URL, starting with https://.',
          pending,
        )
      }
      next = { ...pending, url }
      break
    }
  }

  // Back through the same path a first-time request takes, so a resumed
  // conversation cannot reach a different set of rules than a one-liner.
  return await stageSchedule(actor, fromPending(next), now)
}

/** Rebuilds a parsed intent from carried state. */
function fromPending(p: PendingSchedule): Extract<Intent, { kind: 'schedule' }> {
  return {
    kind: 'schedule',
    withNames: p.withNames,
    when: {
      // The day was already resolved to an instant when it was carried, so
      // it is replayed as an absolute rather than re-derived — otherwise
      // "tomorrow", answered near midnight, would mean a different day on
      // the turn that consumes it than on the turn that heard it.
      day: p.dayIso ? { kind: 'onDate', iso: p.dayIso } : null,
      time: p.hour === null ? null : { hour: p.hour, minute: p.minute ?? 0 },
    },
    durationMinutes: p.durationMinutes,
    provider: p.provider,
    title: p.title,
    url: p.url,
  }
}

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

/** A question, with everything already said carried alongside it. */
const ask = (answer: string, pending: PendingSchedule): AssistantReply => ({
  answer,
  actions: [],
  pending,
})

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

  // Grouped by day, because "3 meetings this week" followed by three bare
  // times is not an answer — it is the same information the question already
  // contained, minus the part that mattered.
  const byDay = groupByDay(meetings, actor.timezone, now)
  const lines = byDay.flatMap(({ day }, i) => {
    const onDay = meetings.filter((m) => dayLabel(m.startsAt, actor.timezone, now) === day)
    return [
      (i > 0 ? '\n' : '') + day.toUpperCase(),
      ...onDay.map(
        (m) =>
          `  ${formatRange(m.startsAt, m.endsAt, actor.timezone)}  ${m.title}` +
          (m.clientName ? ` — ${m.clientName}` : ''),
      ),
    ]
  })

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
  const zone = actor.timezone

  // ── Ask for whatever is missing, in the order a person would ────────────
  // People first: without them there is nothing to schedule. Then the time.
  // Then the platform, and only then the link, because which link to paste
  // depends on the platform. Each question carries everything already said,
  // so nobody retypes a sentence.
  const pendingBase = {
    kind: 'schedule' as const,
    withNames: intent.withNames,
    dayIso: intent.when.day ? resolveDay(intent.when.day, now, zone).toISOString() : null,
    hour: intent.when.time?.hour ?? null,
    minute: intent.when.time?.minute ?? null,
    durationMinutes: intent.durationMinutes,
    provider: intent.provider,
    title: intent.title,
    url: intent.url,
  }

  if (intent.withNames.length === 0) {
    return ask('Who is it with? Name a client or a teammate.', {
      ...pendingBase,
      awaiting: 'people',
    })
  }

  if (intent.when.time === null) {
    return ask('What time? For example "tomorrow at 3pm" or "Friday at 10am".', {
      ...pendingBase,
      awaiting: 'time',
    })
  }

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
  // An internal meeting with nothing said is genuinely "no platform" — the
  // team sits together — so only a client forces the question.
  let provider = intent.provider
  if (!provider) {
    if (client) {
      return ask(
        `Which platform for the ${client.companyName} call — WhatsApp, Google Meet, or Zoom?`,
        { ...pendingBase, awaiting: 'provider' },
      )
    }
    provider = 'none'
  }

  // Meet and Zoom are link-based and nothing here generates one (§4.2), so
  // this is the one question the assistant cannot answer for itself.
  if (generatesLink(provider) && !intent.url) {
    const name = provider === 'zoom' ? 'Zoom' : 'Google Meet'
    return ask(
      `Create the ${name} yourself and paste the link here — nothing in this app can generate one, ` +
        'and a calendar entry with no way to join is worse than none.',
      { ...pendingBase, provider, awaiting: 'link' },
    )
  }

  const startsAt = resolveWhen(intent.when, now, now, actor.timezone)
  const endsAt = new Date(startsAt.getTime() + intent.durationMinutes * 60_000)

  if (startsAt.getTime() < now.getTime()) {
    return plain(
      `That lands in the past — ${whenLabel(startsAt, endsAt, actor.timezone, now)}. Name a day as well as a time.`,
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
    `${title} — ${whenLabel(startsAt, endsAt, actor.timezone, now)}.` +
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
      `That would put ${meeting.title} in the past — ${whenLabel(startsAt, endsAt, actor.timezone, now)}. Name a day as well as a time.`,
    )
  }

  return await stageOrAsk(
    actor,
    meeting,
    'meeting.edit',
    'reschedule_meeting',
    {
      meeting_id: meeting.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    },
    `${meeting.title} moves to ${whenLabel(startsAt, endsAt, actor.timezone, now)}. Everyone on it gets told once you confirm.`,
  )
}

/**
 * The fork at the heart of ADR 0008.
 *
 * If the person may make this change, it is staged as a change. If they may
 * not, it is staged as a *request* to the person who may — same card, same
 * Confirm button, different consequence, and the card says which.
 *
 * A refusal only remains a refusal when there is nobody to ask: a meeting
 * with no other owner, or one the person cannot see at all.
 */
async function stageOrAsk(
  actor: SessionActor,
  meeting: MeetingRow,
  action: 'meeting.edit' | 'meeting.delete',
  tool: 'reschedule_meeting' | 'cancel_meeting' | 'reassign_meeting',
  input: Record<string, unknown>,
  answerWhenAllowed: string,
): Promise<AssistantReply> {
  if (mayDoItThemselves(actor, action, meeting)) {
    return stage(await runTool(actor, tool, input), answerWhenAllowed)
  }

  const approver = approverFor(meeting, actor)
  if (!approver) {
    // Nobody to ask. The tool's own refusal is already phrased for a person.
    return stage(await runTool(actor, tool, input), answerWhenAllowed)
  }

  const who = await approverName(actor, approver)
  const built = describeRequest(actor, meeting, tool, input, who)

  return {
    answer:
      `That is not yours to change, so I will ask ${who} instead. ` +
      `It goes to their chat and nothing happens unless they say yes.`,
    actions: [built],
  }
}

function describeRequest(
  actor: SessionActor,
  meeting: MeetingRow,
  tool: 'reschedule_meeting' | 'cancel_meeting' | 'reassign_meeting',
  input: Record<string, unknown>,
  who: string,
): StagedAction {
  const zone = actor.timezone
  const now = new Date()

  const what =
    tool === 'cancel_meeting'
      ? `cancel ${meeting.title}, ${whenLabel(meeting.startsAt, meeting.endsAt, zone, now)}`
      : tool === 'reschedule_meeting'
        ? `move ${meeting.title} to ${whenLabel(new Date(String(input.starts_at)), new Date(String(input.ends_at)), zone, now)}`
        : `change who is on ${meeting.title}`

  return {
    tool: 'request_approval',
    input: {
      for_tool: tool,
      meeting_id: meeting.id,
      ...(Object.fromEntries(
        Object.entries(input).map(([k, v]) => [k, String(v)]),
      ) as Record<string, string>),
    },
    verb: 'Ask',
    what: `${who} to ${what}`,
  }
}

async function stageCancel(
  actor: SessionActor,
  intent: Extract<Intent, { kind: 'cancel' }>,
  now: Date,
): Promise<AssistantReply> {
  const found = await resolveRef(actor, intent.ref, now)
  if (!found.ok) return plain(found.reason)

  return await stageOrAsk(
    actor,
    found.meeting,
    'meeting.delete',
    'cancel_meeting',
    { meeting_id: found.meeting.id, reason: intent.reason },
    `${found.meeting.title} on ${whenLabel(found.meeting.startsAt, found.meeting.endsAt, actor.timezone, now)} would be cancelled, and its pending reminders dropped.`,
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

  return await stageOrAsk(
    actor,
    found.meeting,
    'meeting.edit',
    'reassign_meeting',
    {
      meeting_id: found.meeting.id,
      from_user_id: leaving.person.id,
      to_user_id: joining.person.id,
    },
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
      .map((m) => `· ${m.title} — ${whenLabel(m.startsAt, m.endsAt, actor.timezone, new Date())}`)
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
