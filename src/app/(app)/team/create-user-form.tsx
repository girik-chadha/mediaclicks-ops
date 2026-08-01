'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createUser, type CreateUserState } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 cursor-pointer rounded-sm bg-signal px-3 text-label font-semibold text-white transition-colors duration-[80ms] hover:bg-ink disabled:opacity-60"
    >
      {/* §8: the toast uses the button's verb. */}
      {pending ? 'Adding' : 'Add person'}
    </button>
  )
}

export function CreateUserForm() {
  const [state, formAction] = useActionState<CreateUserState, FormData>(createUser, {})

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-label text-slate">Full name</span>
          <input
            name="fullName"
            required
            className="h-9 w-full rounded-sm border border-rule bg-surface px-2 text-body"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-label text-slate">Work email</span>
          <input
            name="email"
            type="email"
            required
            placeholder="name@mediaclicks.ae"
            className="h-9 w-full rounded-sm border border-rule bg-surface px-2 text-body"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-label text-slate">Initial password</span>
          <input
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className="h-9 w-full rounded-sm border border-rule bg-surface px-2 text-body"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state.error && (
          <span role="alert" className="text-label text-slate">
            {state.error}
          </span>
        )}
        {state.created && (
          <span role="status" className="text-label text-slate">
            {state.created} added. They sign in with the password you set.
          </span>
        )}
      </div>
    </form>
  )
}
