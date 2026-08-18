'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { requestResetAction, type ForgotState } from './actions'

const CONTROL =
  'h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 h-11 w-full cursor-pointer rounded-sm btn-signal px-4 text-body font-semibold disabled:opacity-60"
    >
      {pending ? 'Sending' : 'Send me a link'}
    </button>
  )
}

export function ForgotForm() {
  const [state, action] = useActionState<ForgotState, FormData>(requestResetAction, {})

  if (state.sent) {
    return (
      <div className="mt-6">
        <p className="text-body leading-[1.5]">
          If that address belongs to an account here, a link is on its way.
        </p>
        <p className="mt-3 text-body leading-[1.5] text-slate">
          It works once and expires in an hour. Check spam before asking for another —
          repeated requests are rate limited.
        </p>
        <a
          href="/login"
          className="mt-6 inline-flex h-11 items-center rounded-sm border border-rule bg-surface px-4 text-body font-medium transition-colors duration-[80ms] hover:border-signal"
        >
          Back to sign in
        </a>
      </div>
    )
  }

  return (
    <form action={action} className="mt-6">
      {state.error && (
        <p
          role="alert"
          className="mb-4 rounded-sm border border-live px-3 py-2 text-label font-medium text-live"
          style={{ borderLeftWidth: 2 }}
        >
          {state.error}
        </p>
      )}

      <label className="block">
        <span className="mb-1 block text-label text-slate">Work email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          className={CONTROL}
        />
      </label>

      <Submit />

      <a
        href="/login"
        className="mt-4 inline-block text-label text-slate underline underline-offset-2"
      >
        Back to sign in
      </a>
    </form>
  )
}
