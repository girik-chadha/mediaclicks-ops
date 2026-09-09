'use server'

import { cookies } from 'next/headers'
import { AuthError } from 'next-auth'
import { REMEMBER_COOKIE, signIn } from '@/server/auth'
import {
  startLoginChallenge,
  twoFactorRequired,
  verifyLoginChallenge,
} from '@/server/auth/challenge'
import { sealGrant } from '@/server/auth/grant'
import { reportUnexpected } from '@/server/report'

/**
 * Signing in, in one step or two.
 *
 * Which one is not the browser's choice: `twoFactorRequired()` is read on the
 * server on every attempt, and the credentials provider refuses a bare
 * password whenever it is true. The two states below are what the *screen*
 * does; the gate is in `authorize()`.
 */

export interface LoginState {
  /** Shown under the form. One message for every kind of refusal. */
  error?: string
  /** Set when a code was sent: the screen swaps to the code step. */
  challengeId?: string
  /** The address the code went to, for "we sent a code to …". */
  sentTo?: string
}

/** One message for wrong password, unknown address and deactivated account.
 *  Saying which would turn the form into a membership oracle for whoever is
 *  phishing this agency next — the same rule the reset endpoint follows. */
const REFUSED = "That email and password don't match."

function readRemember(formData: FormData): boolean {
  const value = formData.get('remember')
  return value === 'on' || value === 'true' || value === '1'
}

/**
 * Remembers the device choice across the OAuth redirect.
 *
 * httpOnly and 10 minutes: long enough to finish a Google consent screen,
 * short enough that it cannot linger and silently lengthen an unrelated
 * sign-in tomorrow.
 */
async function rememberCookie(remember: boolean): Promise<void> {
  const jar = await cookies()
  jar.set(REMEMBER_COOKIE, remember ? '1' : '0', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const remember = readRemember(formData)

  if (!email || !password) {
    return { error: 'Enter your email and password.' }
  }

  // Set before either branch: the password path uses it for its own session,
  // and it also survives a person changing their mind and using Google.
  await rememberCookie(remember)

  if (twoFactorRequired()) {
    let started
    try {
      started = await startLoginChallenge(email, password, remember)
    } catch (error) {
      reportUnexpected('login challenge', error)
      return { error: 'Something went wrong signing you in. Try again.' }
    }

    if (started.status === 'rejected') return { error: REFUSED }
    if (started.status === 'undeliverable') {
      // Deliberately not the same message as a wrong password: this person
      // got their password right, and sending them to reset a working
      // password would be a wild goose chase.
      return {
        error: 'We could not send your code. Try again shortly, or ask an owner.',
      }
    }

    return { challengeId: started.challengeId, sentTo: started.email }
  }

  try {
    await signIn('credentials', {
      email,
      password,
      remember: String(remember),
      redirectTo: '/today',
    })
    return {}
  } catch (error) {
    // signIn throws a NEXT_REDIRECT on success, which must propagate.
    // Only an AuthError is an actual failed sign-in.
    if (error instanceof AuthError) return { error: REFUSED }
    throw error
  }
}

/**
 * Step two: the emailed code.
 *
 * Verifying the code and creating the session are separate calls on purpose.
 * `verifyLoginChallenge` consumes the challenge inside a transaction and
 * hands back a proof; `signIn` exchanges that proof for a session. Nothing
 * between them can turn a wrong code into a session, because the proof is
 * signed by this server and never touches the browser unsigned.
 */
export async function verifyCode(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const challengeId = String(formData.get('challengeId') ?? '')
  const code = String(formData.get('code') ?? '')
  const sentTo = String(formData.get('sentTo') ?? '') || undefined

  if (!challengeId) return { error: 'Start again.' }

  let result
  try {
    result = await verifyLoginChallenge(challengeId, code)
  } catch (error) {
    reportUnexpected('login code', error)
    return { challengeId, sentTo, error: 'Something went wrong. Try again.' }
  }

  if (!result.ok) {
    return { challengeId, sentTo, error: result.reason }
  }

  try {
    await signIn('credentials', {
      grant: sealGrant(result.userId, result.remember),
      redirectTo: '/today',
    })
    return {}
  } catch (error) {
    if (error instanceof AuthError) {
      return { challengeId, sentTo, error: 'That did not go through. Start again.' }
    }
    throw error
  }
}

/** Sets the device cookie, then hands off to Google. */
export async function googleSignIn(formData: FormData): Promise<void> {
  await rememberCookie(readRemember(formData))
  await signIn('google', { redirectTo: '/today' })
}
