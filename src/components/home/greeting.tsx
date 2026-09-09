'use client'

import { useEffect, useState } from 'react'
import { GREET_MS, IN_MS, type GreetPhase } from '@/lib/home/greeting'

/**
 * The sign-in greeting overlay.
 *
 * Sits over a Home that is already mounted and holding real data — that is
 * the whole trick, and why the blur has something to blur. It is not a
 * loading screen standing in for content that has not arrived.
 *
 * ## What changed coming from the prototype
 *
 * The handoff's state machine starts the moment "Sign in" is clicked, in the
 * same update that swaps the screen — it was a single-page prototype where
 * both were one `setState`. Here signing in is a server action that verifies
 * a password (and now a second factor), sets a cookie and redirects, so Home
 * genuinely mounts on the far side of a navigation. The sequence therefore
 * begins when Home mounts rather than on the click, and the button's own
 * pending state covers the wait.
 *
 * The visible result is the same, because nothing in the prototype's version
 * was observable during that gap either. What it does mean is that the
 * "instantaneous" the handoff asks for is bounded by the round trip, which
 * is the one thing about this that a client-only prototype could not model.
 */

/** Runs the handoff's machine: greet → in → idle, then never again. */
export function useGreetPhase(active: boolean): GreetPhase {
  const [phase, setPhase] = useState<GreetPhase>(active ? 'greet' : 'idle')

  useEffect(() => {
    if (!active) return

    /**
     * Strip ?welcome from the address bar immediately.
     *
     * The flag has done its job the moment this runs, and leaving it there
     * would mean a refresh — or a link someone copies out of the bar and
     * sends to a colleague — replaying the greeting on a Home the person is
     * already sitting on. replaceState rather than a router push: this is
     * the same page, and a navigation would remount it and start the
     * sequence over.
     */
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('welcome')) {
        url.searchParams.delete('welcome')
        window.history.replaceState(null, '', url.pathname + url.search)
      }
    } catch {
      // Not fatal — the sequence still plays, it just leaves the parameter.
    }

    const toIn = setTimeout(() => setPhase('in'), GREET_MS)
    const toIdle = setTimeout(() => setPhase('idle'), GREET_MS + IN_MS)

    return () => {
      clearTimeout(toIn)
      clearTimeout(toIdle)
    }
  }, [active])

  return phase
}

export function Greeting({
  phase,
  firstName,
  dateline,
  subline,
}: {
  phase: GreetPhase
  firstName: string
  /** "Wed 09 Sep · 19:17" — the same string Home's own header shows. */
  dateline: string
  subline: string
}) {
  // Unmounted entirely once the sequence is over, so nothing is left over a
  // page the person is now using.
  if (phase === 'idle') return null

  const leaving = phase === 'in'

  return (
    <div
      // aria-hidden, and not a dialog: it holds no controls and traps
      // nothing. A screen reader user is already being read the real Home
      // header underneath, which says the same name — announcing this too
      // would be the same greeting twice.
      aria-hidden
      className="fixed inset-0 z-[46] flex flex-col items-center justify-center"
      style={{
        // --paper, not the handoff's #F7F8FA: near-white on the light theme
        // and near-black on the dark one, so the blur reads as "the app,
        // out of focus" in both rather than a white sheet over a dark app.
        //
        // Two declarations, and the first is the fallback an engine without
        // color-mix keeps: an opaque scrim of the same token. The handoff
        // suggests `rgba(247, 248, 250, 0.6)` there, which is the light
        // value literally — on the dark theme that fallback would drop a
        // white sheet over a dark app, which is worse than the opaque one.
        // Losing the see-through is a smaller loss than losing the theme.
        background: 'var(--paper)',
        backgroundColor: 'color-mix(in srgb, var(--paper) 60%, transparent)',
        animation: leaving
          ? 'greetVeilOut 560ms cubic-bezier(0.7, 0, 0.2, 1) both'
          : 'greetVeilIn 420ms ease-out both',
      }}
    >
      <div
        className="flex flex-col items-center px-6 text-center"
        style={{
          animation: leaving
            ? 'greetTextOut 420ms cubic-bezier(0.7, 0, 0.2, 1) both'
            : 'greetTextIn 520ms cubic-bezier(0.2, 0, 0.2, 1) both',
        }}
      >
        <div className="text-micro uppercase text-slate">{dateline}</div>

        <h1 className="mt-4 font-display text-[4.5rem] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
          Hello, {firstName}.
        </h1>

        {/* Runs once on mount and is not swapped on exit — the handoff has it
            independent of the enter/exit pair, so it draws itself and then
            simply leaves with the block it sits in. */}
        <div
          className="mt-6 h-0.5 w-24 bg-live"
          style={{
            transformOrigin: 'center',
            animation: 'greetRuleIn 520ms cubic-bezier(0.7, 0, 0.2, 1) both',
          }}
        />

        <p className="mt-5 text-body text-slate">{subline}</p>
      </div>
    </div>
  )
}
