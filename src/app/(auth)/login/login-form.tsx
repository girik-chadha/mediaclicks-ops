'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { login, type LoginState } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 cursor-pointer rounded-sm bg-signal text-body font-semibold text-white transition-colors duration-[80ms] hover:bg-ink disabled:opacity-60"
    >
      {pending ? 'Signing in' : 'Sign in'}
    </button>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {})

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <label className="block">
        <span className="mb-1 block text-label text-slate">Work email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@mediaclicks.ae"
          className="h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-label text-slate">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body"
        />
      </label>

      <SubmitButton />

      {state.error && (
        // aria-live so it reaches a screen reader; --live is reserved for
        // time-criticality (brief §3), so an error is not magenta.
        <p role="alert" aria-live="polite" className="text-label text-slate">
          {state.error}
        </p>
      )}
    </form>
  )
}
