'use server'

import { revalidatePath } from 'next/cache'
import type { PerformedAction } from '@/lib/assistant/plan'
import { requireActor } from '@/server/auth/session'
import { performPlan } from '@/server/assistant/execute'
import { planFromPrompt } from '@/server/assistant/planner'
import { seal } from '@/server/assistant/seal'

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
    }
  | { readonly ok: false; readonly error: string }

export async function askAssistant(prompt: string): Promise<AskResult> {
  const trimmed = prompt.trim()
  if (!trimmed) return { ok: false, error: 'Say what you need.' }
  if (trimmed.length > 500) return { ok: false, error: 'That is too long. Try a sentence.' }

  const actor = await requireActor()

  try {
    const { answer, actions } = await planFromPrompt(actor, trimmed)
    return {
      ok: true,
      answer,
      plan: actions.map((a) => ({ verb: a.verb, what: a.what })),
      // Null when there is nothing to do: a question answered is not a plan,
      // and the card should not appear with a Confirm button that does
      // nothing.
      token: actions.length > 0 ? seal(actor.id, actions) : null,
    }
  } catch {
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
