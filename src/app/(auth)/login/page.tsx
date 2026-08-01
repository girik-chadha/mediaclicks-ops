import type { Metadata } from 'next'
import { LogoMark } from '@/components/shell/logo'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in · MediaClicks' }

export default function LoginPage() {
  return (
    <div className="w-[340px]">
      {/* Brief §6.7: wordmark and nothing else. No hero image, no marketing
          copy — this is internal software and pretending otherwise is
          embarrassing. */}
      <LogoMark size={44} className="text-ink" />
      <h1 className="mt-5 font-display text-display-lg">MediaClicks</h1>
      <p className="mt-2 text-micro uppercase text-slate">Operations</p>
      <LoginForm />
    </div>
  )
}
