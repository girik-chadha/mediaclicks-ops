import type { Metadata } from 'next'
import { LogoMark } from '@/components/shell/logo'
import { ForgotForm } from './forgot-form'

export const metadata: Metadata = { title: 'Forgot password · MediaClicks' }

/**
 * Self-service reset, and how everyone gets their first password.
 *
 * Accounts are created without one. Each person comes here, receives a link,
 * and chooses their own — so no temporary password is ever typed by an
 * administrator, read off a screen, or left sitting in a chat thread.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="w-[340px]">
      <LogoMark size={44} className="text-ink" />
      <h1 className="mt-5 font-display text-display-lg">Forgot password</h1>
      <p className="mt-2 text-micro uppercase text-slate">Operations</p>

      <p className="mt-6 text-body leading-[1.5] text-slate">
        Enter your work email and we will send you a link to set a new one. Setting up for
        the first time? Same thing — this is how you choose your first password.
      </p>

      <ForgotForm />
    </div>
  )
}
