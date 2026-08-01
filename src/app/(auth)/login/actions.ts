'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/server/auth'

export interface LoginState {
  error?: string
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { error: 'Enter your email and password.' }
  }

  try {
    await signIn('credentials', { email, password, redirectTo: '/today' })
    return {}
  } catch (error) {
    // signIn throws a NEXT_REDIRECT on success, which must propagate.
    // Only an AuthError is an actual failed sign-in.
    if (error instanceof AuthError) {
      // Deliberately one message for every failure mode — wrong password, no
      // such account, deactivated. Saying which would tell an attacker
      // whether an address is a MediaClicks account, undoing the constant-
      // time work in the credentials provider.
      return { error: "That email and password don't match." }
    }
    throw error
  }
}
