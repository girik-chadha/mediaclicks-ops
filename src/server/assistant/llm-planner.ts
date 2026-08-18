import 'server-only'
import type { AssistantReply, StagedAction } from '@/lib/assistant/plan'
import { whenLabel } from '@/lib/assistant/format'
import { EXAMPLES } from '@/lib/assistant/parse'
import { MODEL_TOOL_DEFS, modelAvailable } from '@/lib/assistant/model-tools'
import { can } from '@/lib/permissions'
import type { SessionActor } from '../auth/session'
import { getMeeting, type MeetingRow } from '../meetings/queries'
import { approverFor, approverName, mayDoItThemselves } from './approvals'
import { runTool, type ToolOutcome } from './tools'

/**
 * The model-backed fallback (ADR 0007, "If the model comes back").
 *
 * The grammar in `src/lib/assistant/parse.ts` is still the first thing every
 * prompt goes through: it is free, instant, and exhaustively tested. This
 * only runs on a refusal — a phrasing the grammar does not recognise — so it
 * is a widening of *breadth*, not a replacement of the deterministic path.
 *
 * It does not get a wider *reach*. It calls the exact same `runTool()` the
 * grammar's planner calls, so every rule from ADR 0007 still holds without
 * this file having to know about them:
 *
 *   - write tools only stage; nothing here can cause a database write.
 *   - every tool still runs `requirePermission()` before it stages anything.
 *   - the only path to an effect is still the signed plan and the Confirm
 *     button — this file returns the same `AssistantReply` the grammar does,
 *     and everything downstream of that seam is unchanged.
 *
 * The one behaviour it adds beyond calling the tools verbatim is the ADR
 * 0008 redirect: if a write tool would fail only because the meeting is not
 * the actor's to change, and someone else could approve it, this asks them
 * instead of surfacing a bare refusal — the same fork `stageOrAsk` makes in
 * the grammar's planner, reimplemented here because the model calls tools
 * directly rather than producing an `Intent` for the planner to inspect.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const MAX_TOOL_TURNS = 6

export { modelAvailable }

interface ToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export async function planFromPromptWithModel(
  actor: SessionActor,
  prompt: string,
): Promise<AssistantReply> {
  if (!modelAvailable()) {
    // No key configured: behave exactly as the grammar-only build did.
    return {
      answer: `I didn't follow that. I understand a fixed set of requests — try one of the examples.\n\n${EXAMPLES.map((e) => `· ${e}`).join('\n')}`,
      actions: [],
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(actor) },
    { role: 'user', content: prompt },
  ]

  const collected: StagedAction[] = []

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    let response: ChatMessage
    try {
      response = await callGroq(messages)
    } catch {
      return {
        answer:
          collected.length > 0
            ? 'Worked out what to do, but lost the connection before I could explain it. The plan below is still good.'
            : "Couldn't reach the AI service just now. Try again in a moment, or use one of the exact phrasings the assistant always understands.",
        actions: collected,
      }
    }

    messages.push(response)

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return {
        answer: (response.content ?? '').trim() || "I couldn't work that out.",
        actions: collected,
      }
    }

    for (const call of response.tool_calls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        // Malformed arguments go back to the model as a tool error, same as
        // any other bad input — it gets a chance to retry with valid JSON.
      }

      const outcome = await executeForModel(actor, call.function.name, args)
      if (outcome.staged) collected.push(outcome.staged)

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: outcome.content,
      })
    }
  }

  return {
    answer: 'That turned into more steps than I could work through in one go — try asking for a smaller piece of it.',
    actions: collected,
  }
}

/**
 * Wraps `runTool` with the ADR 0008 redirect for the three tools whose
 * subject is an existing meeting. Every other tool goes straight through
 * unchanged — `runTool` is still the only place a permission is checked.
 */
async function executeForModel(
  actor: SessionActor,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (name === 'reschedule_meeting' || name === 'cancel_meeting' || name === 'reassign_meeting') {
    const meeting = await loadMeeting(actor, String(args.meeting_id ?? ''))
    if (meeting) {
      const action = name === 'cancel_meeting' ? 'meeting.delete' : 'meeting.edit'
      if (!mayDoItThemselves(actor, action, meeting)) {
        const approver = approverFor(meeting, actor)
        if (approver) {
          const who = await approverName(actor, approver)
          return {
            staged: buildApprovalRequest(actor, name, args, meeting, who),
            content: `Not yours to change directly — this will be sent to ${who} to approve instead. Staged, not yet done.`,
          }
        }
      }
    }
  }

  return runTool(actor, name, args)
}

function buildApprovalRequest(
  actor: SessionActor,
  tool: 'reschedule_meeting' | 'cancel_meeting' | 'reassign_meeting',
  input: Record<string, unknown>,
  meeting: MeetingRow,
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

async function loadMeeting(actor: SessionActor, id: string): Promise<MeetingRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  const found = await getMeeting(actor, id)
  if (!found) return null
  return can(actor, 'meeting.view', {
    orgId: actor.orgId,
    createdByUserId: found.createdByUserId,
    attendeeIds: found.attendeeIds,
  })
    ? found
    : null
}

/* ── Groq call ────────────────────────────────────────────────────────── */

async function callGroq(messages: ChatMessage[]): Promise<ChatMessage> {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: MODEL_TOOL_DEFS,
      tool_choice: 'auto',
      temperature: 0.2,
    }),
    // The panel already shows a busy state; this bounds how long a request
    // can sit before the person gets any answer at all.
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(`Groq returned ${res.status}`)
  }

  const body = (await res.json()) as {
    choices: readonly { message: ChatMessage }[]
  }
  const message = body.choices[0]?.message
  if (!message) throw new Error('Groq returned no message')
  return message
}

/* ── System prompt ───────────────────────────────────────────────────── */

function systemPrompt(actor: SessionActor): string {
  const now = new Date()
  return `You are the scheduling assistant inside MediaClicks' internal ops tool.
You are talking to ${actor.fullName} (user id ${actor.id}). The current time is ${now.toISOString()} (UTC); their timezone is ${actor.timezone}. Resolve relative dates ("tomorrow", "next Thursday") against that.

Rules, and they are not optional:
- Never invent a meeting id, user id, or client id. Call list_team, list_clients, or list_my_meetings first and use the ids they return.
- Tools that change something (create_meeting, reschedule_meeting, cancel_meeting, reassign_meeting, notify_user) do not actually do anything when you call them — they only stage a proposal that a human must confirm by clicking a button. Never say a change is "done"; say what *would* happen.
- Nothing can generate a Google Meet or Zoom link. If one is needed and wasn't given to you, ask the person to paste it rather than inventing one.
- If a write tool's result says it was not the person's to change, that is not a failure to retry — it has already been redirected to the right approver, or it genuinely cannot be done. Report it plainly.
- If a request names a meeting ambiguously (more than one match) or is missing something a tool needs and cannot be looked up, ask a short clarifying question instead of guessing. Guessing wrong on a cancellation or a reassignment is the worst outcome here, worse than asking.
- Keep your final reply to one or two short sentences, like a colleague answering in chat — not a report.
- If what's being asked has nothing to do with meetings, scheduling, the team, or clients, say plainly that this assistant only handles scheduling.`
}

