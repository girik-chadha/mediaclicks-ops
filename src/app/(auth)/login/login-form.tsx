'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { login, type LoginState } from './actions'

const CONTROL =
  'h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 cursor-pointer rounded-sm btn-signal text-body font-semibold disabled:opacity-60"
    >
      {pending ? 'Signing in' : 'Sign in'}
    </button>
  )
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {})
  const [googleNote, setGoogleNote] = useState(false)

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
          className={CONTROL}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-label text-slate">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={CONTROL}
        />
      </label>

      <SubmitButton />

      {/*
        The design has this button, so it is here. What it must not be is a
        control that looks live and silently does nothing — so when Google
        sign-in is not configured it says so on click rather than failing
        somewhere the person cannot see.
      */}
      <button
        type="button"
        onClick={() => {
          if (googleEnabled) window.location.href = '/api/auth/signin/google'
          else setGoogleNote(true)
        }}
        className="h-11 cursor-pointer rounded-sm border border-rule bg-surface text-body font-medium transition-colors duration-[80ms] hover:border-signal"
      >
        Continue with Google
      </button>

      {googleNote && (
        <p role="status" className="text-label text-slate">
          Google sign-in isn&rsquo;t set up yet. Use your email and password.
        </p>
      )}

      <a href="/forgot" className="text-label font-medium">
        Forgot password
      </a>

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
