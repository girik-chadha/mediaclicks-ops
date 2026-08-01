import type { Metadata } from 'next'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in · MediaClicks' }

export default function LoginPage() {
  return (
    <div className="w-[340px]">
      {/* Brief §6.7: wordmark and nothing else. No hero image, no marketing
          copy — this is internal software and pretending otherwise is
          embarrassing. */}
      <h1 className="font-display text-display-lg">MediaClicks</h1>
      <p className="mt-2 text-micro uppercase text-slate">Operations</p>
      <LoginForm />
    </div>
  )
}
