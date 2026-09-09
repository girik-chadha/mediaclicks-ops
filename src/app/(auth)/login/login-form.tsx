'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { googleSignIn, login, verifyCode, type LoginState } from './actions'

/** The design's .fld, as a class rather than repeated four times. */
const FIELD =
  'h-[46px] w-full rounded-[2px] border border-rule bg-surface px-3.5 text-body text-ink transition-colors duration-[80ms] focus:border-signal focus:outline-none'

const LABEL = 'block text-label text-slate'

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 flex h-12 cursor-pointer items-center justify-center gap-2.5 rounded-[2px] bg-ink text-body font-semibold tracking-[-0.01em] text-invert-fg transition-transform duration-[120ms] ease-out hover:-translate-y-px disabled:translate-y-0 disabled:opacity-60"
    >
      {pending ? busy : idle}
      <span className="font-mono text-signal" aria-hidden>
        →
      </span>
    </button>
  )
}

/** Google's mark. Inline so the login screen makes no third-party request. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  )
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {})
  const [codeState, codeAction] = useActionState<LoginState, FormData>(verifyCode, {})
  const [remember, setRemember] = useState(false)
  const [googleNote, setGoogleNote] = useState(false)

  /**
   * Which step is on screen.
   *
   * Driven by whether a challenge exists, not by a separate flag — there is
   * one source of truth for "a code is outstanding", and it comes from the
   * server. The code step keeps its own challenge id so a wrong guess
   * re-renders the same step rather than dropping back to the password.
   */
  const challengeId = codeState.challengeId ?? state.challengeId
  const sentTo = codeState.sentTo ?? state.sentTo

  if (challengeId) {
    return (
      <form action={codeAction} className="mt-8 flex flex-col gap-4">
        <input type="hidden" name="challengeId" value={challengeId} />
        <input type="hidden" name="sentTo" value={sentTo ?? ''} />

        <p className="text-body text-slate">
          {sentTo ? (
            <>
              We sent a six-digit code to <span className="text-ink">{sentTo}</span>. It
              expires in ten minutes.
            </>
          ) : (
            'Enter the six-digit code we just sent you.'
          )}
        </p>

        <label className="block">
          <span className={`${LABEL} mb-1.5`}>Sign-in code</span>
          <input
            name="code"
            // Not type="number": it strips leading zeros, and 012345 is a
            // valid code. inputMode gets the numeric keypad without that.
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            placeholder="000000"
            className={`${FIELD} font-mono text-center text-[1.25rem] tracking-[0.4em]`}
          />
        </label>

        <SubmitButton idle="Verify and sign in" busy="Verifying" />

        {codeState.error && (
          <p role="alert" aria-live="polite" className="text-label text-slate">
            {codeState.error}
          </p>
        )}

        <a href="/login" className="text-label font-medium">
          Start again
        </a>
      </form>
    )
  }

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      <label className="block">
        <span className={`${LABEL} mb-1.5`}>Work email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@mediaclicks.ae"
          className={FIELD}
        />
      </label>

      <label className="block">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className={LABEL}>Password</span>
          <a href="/forgot" className="text-label font-medium">
            Forgot?
          </a>
        </div>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className={FIELD}
        />
      </label>

      {/*
        A real checkbox, visually hidden and driven by the label — so it is
        reachable by keyboard and announced by a screen reader, which a div
        with an onClick would not be. The box beside it is the design's.
      */}
      <label className="mt-0.5 flex cursor-pointer select-none items-center gap-2.5">
        <input
          type="checkbox"
          name="remember"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={`flex size-[18px] flex-none items-center justify-center rounded-[2px] border text-[0.625rem] font-semibold text-white transition-colors duration-[80ms] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal ${
            remember ? 'border-signal bg-signal' : 'border-rule bg-surface'
          }`}
        >
          {remember ? '✓' : ''}
        </span>
        <span className="text-label text-slate">Keep me signed in on this device</span>
      </label>

      <SubmitButton idle="Sign in" busy="Signing in" />

      <div className="my-1 flex items-center gap-3">
        <div className="h-px flex-1 bg-rule" />
        <div className="text-micro uppercase text-slate">or</div>
        <div className="h-px flex-1 bg-rule" />
      </div>

      {/*
        Submits the same form, so the checkbox above applies to Google too —
        it sits above both buttons in the design, and a box that silently only
        governed one of them would be lying.

        When Google is not configured the button says so on click rather than
        failing somewhere the person cannot see.
      */}
      <button
        type={googleEnabled ? 'submit' : 'button'}
        formAction={googleEnabled ? googleSignIn : undefined}
        onClick={googleEnabled ? undefined : () => setGoogleNote(true)}
        className="flex h-12 cursor-pointer items-center justify-center gap-3 rounded-[2px] border border-rule bg-surface text-body font-medium text-ink transition-colors duration-[80ms] hover:border-signal"
      >
        <GoogleMark />
        Continue with Google
      </button>

      {googleNote && (
        <p role="status" className="text-label text-slate">
          Google sign-in isn&rsquo;t set up yet. Use your email and password.
        </p>
      )}

      {state.error && (
        // aria-live so it reaches a screen reader; --live is reserved for
        // time-criticality (brief §3), so an error is not magenta.
        <p role="alert" aria-live="polite" className="text-label text-slate">
          {state.error}
        </p>
      )}
    </form>
  )
}
