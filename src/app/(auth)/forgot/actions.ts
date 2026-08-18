'use server'

import { headers } from 'next/headers'
import { reportUnexpected } from '@/server/report'

export interface ForgotState {
  error?: string
  sent?: boolean
}

/**
 * The reply is the same whether the address exists or not.
 *
 * Anything else makes this form a way to test who works here — type an
 * address, read the answer. That is worth real money to whoever is deciding
 * who to phish, and it costs the honest user nothing to be told "if that
 * address is on the system, a link is on its way".
 *
 * The one exception is email being unconfigured, which is not a fact about
 * any account and leaves the person waiting for a message that will never
 * arrive if we stay quiet about it.
 */
export async function requestResetAction(
  _prev: ForgotState,
  form: FormData,
): Promise<ForgotState> {
  const email = String(form.get('email') ?? '')

  // The deployed origin, so the link in the email points at this
  // installation rather than at a hardcoded URL that is wrong in every
  // environment but one.
  const head = await headers()
  const host = head.get('x-forwarded-host') ?? head.get('host') ?? 'localhost:3000'
  const proto = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')

  try {
    const { requestPasswordReset, pruneResetTokens } = await import('@/server/auth/reset')
    await requestPasswordReset(email, `${proto}://${host}`)
    // Cheap, and saves a scheduled job for a small table.
    await pruneResetTokens()
  } catch (error) {
    if (error instanceof Error && error.name === 'ResetUnavailableError') {
      return { error: error.message }
    }
    reportUnexpected('password reset request', error)
    // Still reported as sent: a failure here must not become a signal about
    // whether the address exists.
    return { sent: true }
  }

  return { sent: true }
}

export interface ResetState {
  error?: string
  done?: boolean
}

export async function completeResetAction(
  _prev: ResetState,
  form: FormData,
): Promise<ResetState> {
  const token = String(form.get('token') ?? '')
  const password = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')

  if (password !== confirm) return { error: 'Those two passwords are different.' }

  try {
    const { completePasswordReset } = await import('@/server/auth/reset')
    const result = await completePasswordReset(token, password)
    if (!result.ok) return { error: result.reason }
  } catch (error) {
    reportUnexpected('password reset complete', error)
    return { error: 'That did not go through. Ask for a new link.' }
  }

  return { done: true }
}
