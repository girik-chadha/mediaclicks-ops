import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { StagedAction } from '@/lib/assistant/plan'
import { TOOLS } from '@/lib/assistant/tools'
import type { SessionActor } from '../auth/session'
import { runTool } from './tools'

/**
 * The agent loop (§4.6).
 *
 * A manual loop rather than the SDK's tool runner, for one reason: the loop
 * has a side channel. Write tools return a staged action *alongside* the
 * text the model sees, and those staged actions are the plan the human
 * confirms. Owning the loop keeps the collection of them obvious and keeps
 * the beta surface out of a codebase that is otherwise on stable APIs.
 *
 * Bounded turns, a fixed toolset, and no tool with an effect. The worst a
 * runaway loop can do here is spend tokens.
 */

const MODEL = 'claude-opus-5'

/**
 * Six is enough for the intended shape of work: look up the team, look up
 * the meetings, find a slot, stage one or two changes, then answer. A model
 * still calling tools after six has misunderstood, and looping further would
 * spend money to arrive somewhere worse.
 */
const MAX_TURNS = 6

export interface AgentResult {
  readonly answer: string
  readonly actions: readonly StagedAction[]
}

export class AssistantUnconfiguredError extends Error {
  override readonly name = 'AssistantUnconfiguredError'
  constructor() {
    super('The assistant is not connected yet.')
  }
}

export function assistantIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Written against Opus 5's tendencies rather than in the abstract: it is
 * verbose by default and narrates more than a 480px panel has room for, so
 * the length instruction is explicit; and it will otherwise widen a task
 * ("while I'm here, I also…"), which is the last thing you want from
 * something holding a Cancel button.
 */
function systemPrompt(actor: SessionActor, now: Date): string {
  return [
    'You are the scheduling assistant inside MediaClicks Ops, an internal tool for a',
    'social media marketing agency. You help one person manage their meetings.',
    '',
    `The person you are helping is ${actor.fullName}. Their user id is ${actor.id}.`,
    `Their timezone is ${actor.timezone}. It is currently ${now.toISOString()}.`,
    'Interpret vague times ("Thursday", "next week", "tomorrow morning") in their',
    'timezone, and state times back in it.',
    '',
    'Nothing you do takes effect. reschedule_meeting, cancel_meeting,',
    'reassign_meeting and notify_user only stage a change; the person sees it on a',
    'card and clicks Confirm, or does not. Never say a change has been made, is',
    'being made, or has been sent. Describe what will happen if they confirm.',
    '',
    'Never invent a meeting id, a user id, or a meeting that was not returned by a',
    'tool. Look things up. If a tool refuses because of permissions, say so plainly',
    'and say who could do it instead — do not try another route to the same change.',
    '',
    'Do only what was asked. If the request is ambiguous in a way that changes which',
    'meeting or which time, ask one short question instead of guessing and staging.',
    '',
    'Answer in one or two sentences. The card lists the changes, so do not list them',
    'again in prose. No preamble, no headings, no bullet points, no restating the',
    'request back.',
  ].join('\n')
}

export async function runAssistant(
  actor: SessionActor,
  prompt: string,
): Promise<AgentResult> {
  if (!assistantIsConfigured()) throw new AssistantUnconfiguredError()

  const client = new Anthropic()
  const now = new Date()

  const tools: Anthropic.Tool[] = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    // Guarantees the arguments validate against the schema, so the executors
    // are handling malformed input from a bug rather than from the model.
    strict: true,
  }))

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
  const staged: StagedAction[] = []

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt(actor, now),
      // Adaptive is Opus 5's default; set explicitly so a model change does
      // not silently alter how much thinking this does.
      thinking: { type: 'adaptive' },
      // Deliberately not `high`. Someone is watching a spinner in a 480px
      // panel, and on a seven-tool surface with no ambiguity about which
      // tool applies, the extra deliberation buys latency, not accuracy.
      output_config: { effort: 'medium' },
      tools,
      messages,
    })

    // Safety classifiers can decline, and that arrives as a successful
    // response with an empty content array — reading content[0] first would
    // throw on the one path that most needs a clear message.
    if (response.stop_reason === 'refusal') {
      return { answer: "I can't help with that one.", actions: [] }
    }

    messages.push({ role: 'assistant', content: response.content })

    const calls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )

    if (calls.length === 0) {
      // A model that stages changes and says nothing still needs a caption
      // above the card.
      const answer =
        textOf(response) ||
        (staged.length ? 'Here is what that would change.' : 'Nothing to do.')
      return { answer, actions: staged }
    }

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const call of calls) {
      const outcome = await runTool(actor, call.name, call.input)
      if (outcome.staged) staged.push(outcome.staged)
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      })
    }

    // All results in one user message. Splitting them across messages is
    // accepted by the API and quietly teaches the model to stop batching
    // calls, which doubles the round trips on exactly the requests that
    // benefit most from parallelism.
    messages.push({ role: 'user', content: results })
  }

  // Ran out of turns. Whatever was staged is still valid and still requires
  // confirmation, so it is offered rather than thrown away.
  return {
    answer: staged.length
      ? 'I got this far before I ran out of steps. Check it before confirming.'
      : "I couldn't work that one out. Try saying it a different way.",
    actions: staged,
  }
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}
