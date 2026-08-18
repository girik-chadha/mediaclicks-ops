import type { Metadata } from 'next'
import { LogoMark } from '@/components/shell/logo'
import { checkResetToken } from '@/server/auth/reset'
import { ResetForm } from './reset-form'

export const metadata: Metadata = { title: 'Set password · MediaClicks' }

/**
 * The other end of the emailed link.
 *
 * The token is checked before the form renders, but *not* spent — someone
 * who opens the link and closes the tab must still be able to use it. It is
 * consumed by the submit, in the same transaction that sets the password.
 */
export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const checked = await checkResetToken(token)

  if (!checked.ok) {
    return (
      <div className="w-[340px]">
        <LogoMark size={44} className="text-ink" />
        <h1 className="mt-5 font-display text-display-lg">Link not usable</h1>
        <p className="mt-6 text-body leading-[1.5] text-slate">{checked.reason}</p>
        <p className="mt-3 text-body leading-[1.5] text-slate">
          Links work once and last an hour. Asking for another takes a moment.
        </p>
        <a
          href="/forgot"
          className="mt-6 inline-flex h-11 items-center rounded-sm btn-signal px-4 text-body font-semibold"
        >
          Send a new link
        </a>
      </div>
    )
  }

  return (
    <div className="w-[340px]">
      <LogoMark size={44} className="text-ink" />
      <h1 className="mt-5 font-display text-display-lg">Set a password</h1>
      <p className="mt-2 text-micro uppercase text-slate">Operations</p>
      <ResetForm token={token} email={checked.email} />
    </div>
  )
}
