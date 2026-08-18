'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { completeResetAction, type ResetState } from '../../forgot/actions'

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
      {pending ? 'Saving' : 'Set password'}
    </button>
  )
}

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<ResetState, FormData>(completeResetAction, {})

  if (state.done) {
    return (
      <div className="mt-6">
        <p className="text-body leading-[1.5]">Password set. You can sign in now.</p>
        <a
          href="/login"
          className="mt-6 inline-flex h-11 items-center rounded-sm btn-signal px-4 text-body font-semibold"
        >
          Sign in
        </a>
      </div>
    )
  }

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <p
          role="alert"
          className="mb-4 rounded-sm border border-live px-3 py-2 text-label font-medium text-live"
          style={{ borderLeftWidth: 2 }}
        >
          {state.error}
        </p>
      )}

      <p className="mb-4 text-label text-slate">
        Setting the password for <span className="text-ink">{email}</span>.
      </p>

      <label className="block">
        <span className="mb-1 block text-label text-slate">New password</span>
        {/* The browser is told this is a new password so it offers to
            generate and remember one rather than autofilling the old. */}
        <input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          autoFocus
          className={CONTROL}
        />
        <span className="mt-1 block text-label text-slate">At least 12 characters.</span>
      </label>

      <label className="mt-4 block">
        <span className="mb-1 block text-label text-slate">Again</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className={CONTROL}
        />
      </label>

      <Submit />
    </form>
  )
}
