'use client'

import { useState, useTransition } from 'react'
import type { TwoFactorStatus } from '@/lib/auth/two-factor'
import { setTwoFactorAction } from './two-factor-actions'

/**
 * The permanent control, as opposed to Home's one-time offer.
 *
 * Four states, not two. "On" and "on, but nothing can be sent" are genuinely
 * different situations for the person reading this — the second one means
 * they are not currently being protected by a thing they switched on, and a
 * toggle that renders it identically to the first is lying by omission.
 */
export function TwoFactorSection({
  status,
  email,
}: {
  status: TwoFactorStatus
  email: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const on = status === 'on' || status === 'on-but-undeliverable'

  const toggle = () => {
    setError(null)
    startTransition(async () => {
      const result = await setTwoFactorAction(!on)
      if (!result.ok) setError(result.error)
    })
  }

  const body =
    status === 'on'
      ? `On. Signing in asks for a six-digit code sent to ${email}.`
      : status === 'on-but-undeliverable'
        ? `Switched on, but email is not configured — so no code can be sent and sign-in is not asking for one. Ask an owner to set up email.`
        : status === 'unavailable'
          ? 'Unavailable until email is configured, because there would be no way to send you a code. Ask an owner to set it up.'
          : `Off. Turn it on and signing in will ask for a six-digit code sent to ${email}.`

  return (
    <section className="min-w-0 flex-1 rounded-sm border border-rule bg-surface p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="text-micro uppercase text-slate">Sign-in security</div>
        <div
          className={`text-micro uppercase ${status === 'on' ? 'text-signal' : 'text-slate'}`}
        >
          {on ? 'On' : 'Off'}
        </div>
      </div>

      <p className="mt-2 text-body leading-[1.5] text-slate text-pretty">{body}</p>

      {error && (
        <p role="alert" className="mt-2 text-label text-slate">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={toggle}
        // Off *and* undeliverable is the only combination with nothing to do:
        // turning it on would store a preference that changes nothing.
        disabled={pending || status === 'unavailable'}
        className="mt-4 h-10 w-full cursor-pointer rounded-sm border border-rule bg-surface px-4 text-body font-medium transition-colors duration-[80ms] hover:border-signal disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving' : on ? 'Turn off' : 'Turn on'}
      </button>

      {on && (
        <p className="mt-2 text-label text-slate">
          Losing access to that inbox means losing access to this account — an owner
          would have to turn this off for you.
        </p>
      )}
    </section>
  )
}
