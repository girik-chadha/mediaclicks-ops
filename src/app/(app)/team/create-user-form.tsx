'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createUser, type CreateUserState } from './actions'

const FIELD = 'h-9 w-full rounded-sm border border-rule bg-surface px-2 text-body'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 cursor-pointer rounded-sm btn-signal px-3 text-label font-semibold disabled:opacity-60"
    >
      {/* §8: the toast uses the button's verb. */}
      {pending ? 'Adding' : 'Add person'}
    </button>
  )
}

/**
 * Owner-only, and enforced in `createUser` — this form is presentation.
 *
 * No password field. The account is created without one, and the person
 * sets their own from the emailed link — the same route they will use if
 * they ever forget it. The success message says exactly that, because the
 * owner is about to message them and needs the right sentence to send.
 */
export function CreateUserForm() {
  const [state, formAction] = useActionState<CreateUserState, FormData>(createUser, {})

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-label text-slate">First name</span>
          <input name="firstName" required maxLength={100} autoComplete="off" className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block text-label text-slate">Last name</span>
          <input name="lastName" maxLength={100} autoComplete="off" className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block text-label text-slate">Work email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="name@mediaclicks.ae"
            className={FIELD}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <SubmitButton />
        {state.error && (
          <span role="alert" className="text-label text-slate">
            {state.error}
          </span>
        )}
        {state.created && (
          <span role="status" className="text-label text-slate">
            {state.created} added as a Member. Tell them: go to the sign-in page, click
            &ldquo;Forgot password&rdquo;, and set one from the emailed link.
          </span>
        )}
      </div>
    </form>
  )
}
