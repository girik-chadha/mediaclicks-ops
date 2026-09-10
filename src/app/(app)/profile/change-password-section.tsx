'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { changePasswordAction, type ChangePasswordState } from './change-password-actions'

const CONTROL =
  'h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'
const LABEL = 'mb-1 block text-label font-medium text-slate'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 w-full cursor-pointer rounded-sm btn-signal px-4 text-body font-semibold disabled:opacity-60"
    >
      {pending ? 'Changing' : 'Change password'}
    </button>
  )
}

/**
 * Three fields, one rule set, and the form clears itself on success.
 *
 * Cleared on purpose: a password form still holding the new password after
 * it has been saved is a password on screen for as long as the tab is open,
 * for anyone walking past.
 */
export function ChangePasswordSection() {
  const [state, action] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    {},
  )
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.done) form.current?.reset()
  }, [state.done])

  return (
    <form ref={form} action={action} className="mt-4 flex flex-col gap-3">
      <label className="block">
        <span className={LABEL}>Current password</span>
        <input
          name="current"
          type="password"
          required
          autoComplete="current-password"
          className={CONTROL}
        />
      </label>

      <label className="block">
        <span className={LABEL}>New password</span>
        <input
          name="next"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className={CONTROL}
        />
        <span className="mt-1 block text-label text-slate">At least 12 characters.</span>
      </label>

      <label className="block">
        <span className={LABEL}>Confirm new password</span>
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

      {state.error && (
        <p role="alert" aria-live="polite" className="text-label text-slate">
          {state.error}
        </p>
      )}
      {state.done && (
        <p role="status" aria-live="polite" className="text-label text-slate">
          Password changed. Other devices you are signed in on stay signed in until their
          session ends.
        </p>
      )}
    </form>
  )
}
