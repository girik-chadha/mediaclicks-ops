'use server'

import { revalidatePath } from 'next/cache'
import { reportUnexpected } from '@/server/report'
import type { PendingSchedule, PerformedAction } from '@/lib/assistant/plan'
import { requireActor } from '@/server/auth/session'
import { performPlan } from '@/server/assistant/execute'
import { planFromAnswer, planFromPrompt } from '@/server/assistant/planner'
import { seal, unseal } from '@/server/assistant/seal'

/**
 * The two calls the assistant panel makes: ask, then confirm.
 *
 * They are separate round trips on purpose. Between them the plan sits in
 * the browser, signed, having done nothing — which is what makes the card
 * an honest confirmation rather than a progress notice.
 */

export interface PlanLine {
  readonly verb: string
  readonly what: string
}

export type AskResult =
  | {
      readonly ok: true
      readonly answer: string
      readonly plan: PlanLine[]
      readonly token: string | null
      /**
       * Set when the reply was a question. Handed straight back on the next
       * message so the assistant remembers what was already said — sealed,
       * because a conversation the browser can rewrite is not a
       * conversation the server can trust.
       */
      readonly context: string | null
    }
  | { readonly ok: false; readonly error: string }

export async function askAssistant(
  prompt: string,
  context?: string | null,
): Promise<AskResult> {
  const trimmed = prompt.trim()
  if (!trimmed) return { ok: false, error: 'Say what you need.' }
  if (trimmed.length > 500) return { ok: false, error: 'That is too long. Try a sentence.' }

  const actor = await requireActor()

  try {
    // A reply to a question the assistant asked goes down a different path:
    // "3pm" is a time only because a time is what was asked for.
    const reply = context
      ? await planFromAnswer(actor, unseal<PendingSchedule>(context, actor.id), trimmed)
      : await planFromPrompt(actor, trimmed)

    return {
      ok: true,
      answer: reply.answer,
      plan: reply.actions.map((a) => ({ verb: a.verb, what: a.what })),
      // Null when there is nothing to do: a question answered is not a plan,
      // and the card should not appear with a Confirm button that does
      // nothing.
      token: reply.actions.length > 0 ? seal(actor.id, reply.actions) : null,
      context: reply.pending ? seal(actor.id, reply.pending) : null,
    }
  } catch (error) {
    reportUnexpected('assistant ask', error)
    return { ok: false, error: 'Something went wrong working that out. Try again.' }
  }
}

export type ConfirmResult =
  | { readonly ok: true; readonly done: PerformedAction[] }
  | { readonly ok: false; readonly error: string }

export async function confirmAssistant(token: string): Promise<ConfirmResult> {
  try {
    const done = await performPlan(token)

    // The meeting may now be on a screen the person is looking at.
    revalidatePath('/calendar')
    revalidatePath('/today')
    revalidatePath('/home')
    revalidatePath('/chat')

    return { ok: true, done }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'That did not go through.',
    }
  }
}
