import type { Metadata } from 'next'
import { LogoMark } from '@/components/shell/logo'

export const metadata: Metadata = { title: 'Forgot password · MediaClicks' }

/**
 * There is no self-service reset yet, and inventing one would mean building
 * token issuance, expiry and email delivery — none of which exists.
 *
 * §8: say what happened and what to do. A page that explains the real path is
 * worth more than a form that emails nothing.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="w-[340px]">
      <LogoMark size={44} className="text-ink" />
      <h1 className="mt-5 font-display text-display-lg">Forgot password</h1>
      <p className="mt-2 text-micro uppercase text-slate">Operations</p>

      <p className="mt-6 text-body leading-[1.5] text-slate">
        There is no self-service reset yet. Ask an owner to set you a new one — it takes
        them a few seconds — then sign in and change it.
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
