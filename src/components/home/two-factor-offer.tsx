'use client'

import { useState, useTransition } from 'react'
import { dismissOfferAction, enableTwoFactorAction } from '@/app/(app)/home/two-factor-actions'

/**
 * The one-time offer to turn on a second factor.
 *
 * Shown on Home to somebody who has not enabled it and has not already said
 * no. Not in "Needs you": that section is real operational work derived from
 * real rows, and a suggestion sitting among items that each mean somebody is
 * blocked would devalue the ones that do.
 *
 * Disappears optimistically on either button, because both outcomes are the
 * same from here — this card is gone — and waiting on a round trip to
 * acknowledge "no thanks" is the kind of small rudeness that makes software
 * feel slow. The write still happens; if it fails the card returns on the
 * next load, which is the correct end state anyway.
 */
export function TwoFactorOffer() {
  const [gone, setGone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (gone) return null

  const dismiss = () => {
    setGone(true)
    startTransition(async () => {
      await dismissOfferAction()
    })
  }

  const enable = () => {
    setGone(true)
    startTransition(async () => {
      const result = await enableTwoFactorAction()
      if (!result.ok) {
        // Put it back and say why, rather than leaving someone believing
        // they turned on a protection they did not.
        setGone(false)
        setError(result.error)
      }
    })
  }

  return (
    <div className="mt-6 flex items-start gap-4 rounded-sm border border-rule bg-surface p-4">
      <div className="min-w-0 flex-1">
        <div className="text-micro uppercase text-slate">Sign-in security</div>
        <p className="mt-2 text-body leading-[1.4] text-pretty">
          Add a second step when you sign in. We&rsquo;ll email you a six-digit code,
          so knowing your password alone isn&rsquo;t enough to get in.
        </p>
        {error && (
          <p role="alert" className="mt-2 text-label text-slate">
            {error}
          </p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={enable}
            className="h-9 cursor-pointer rounded-sm btn-signal px-3 text-label font-semibold"
          >
            Turn it on
          </button>
          <span className="text-label text-slate">
            You can change this any time in Profile.
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={dismiss}
        // A real label, not a bare glyph: "×" alone is announced as
        // "multiplication sign" or skipped entirely.
        aria-label="Don't show this again"
        title="Don't show this again"
        className="-mr-1 -mt-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-slate transition-colors duration-[80ms] hover:bg-hover hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path
            d="M1 1l12 12M13 1L1 13"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      </button>
    </div>
  )
}
