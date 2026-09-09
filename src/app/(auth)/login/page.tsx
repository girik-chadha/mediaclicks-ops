import type { Metadata } from 'next'
import { LoginForm } from './login-form'
import { LoginHero } from './login-hero'

export const metadata: Metadata = { title: 'Sign in · MediaClicks' }

/**
 * Two panels: the product, then the door.
 *
 * The left panel is the one piece of persuasion in the app, and the brief
 * allows it here for a reason it does not allow anywhere else — it is not
 * marketing, it is the product's own timeline running live behind the form.
 * Someone who has not signed in yet can already see the thing has a pulse.
 *
 * Everything on it is real: the clock ticks in the viewer's own zone, and the
 * playhead on the Rail beside it is the same component every signed-in screen
 * uses. Nothing here is a screenshot.
 */
export default function LoginPage() {
  return (
    // Pinned light, not theme-following: see the [data-theme='light'] block
    // in globals.css. Forgot and reset are plain cards using the same
    // tokens as every signed-in screen and are deliberately left out of
    // this — they should still follow whatever the visitor's OS prefers.
    <div data-theme="light" className="flex min-h-0 w-full flex-1">
      <LoginHero />

      <div className="flex flex-1 items-center justify-center overflow-y-auto bg-paper p-12">
        <div className="w-[340px] max-w-full">
          <h1 className="font-display text-display-sm">Welcome back</h1>
          <p className="mt-2 text-body text-slate">
            Sign in to the MediaClicks operations desk.
          </p>

          <LoginForm
            googleEnabled={Boolean(
              process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
            )}
          />

          <p className="mt-8 text-label font-normal leading-[1.5] text-slate">
            Trouble signing in? Ask an owner to check your access.
          </p>
        </div>
      </div>
    </div>
  )
}
