'use client'

/**
 * Brief §8: errors state what happened and what to do. They do not
 * apologise, and they never say "Something went wrong."
 *
 * ForbiddenError already carries a sentence in that voice — "Emma can't edit
 * other people's meetings" — so it is shown as-is. Anything else gets a
 * generic line, because an unexpected error's message is for the logs, not
 * for the person reading it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isForbidden = error.name === 'ForbiddenError'

  return (
    <div className="p-6">
      <div className="max-w-prose rounded-sm border border-rule bg-surface p-6">
        <p className="font-display text-display-sm">
          {isForbidden ? error.message : 'That didn’t load'}
        </p>
        <p className="mt-2 text-body text-slate">
          {isForbidden
            ? 'Ask an owner if you need this.'
            : 'The page failed to load. Trying again usually works.'}
        </p>
        {!isForbidden && (
          <button
            type="button"
            onClick={reset}
            className="mt-4 h-8 cursor-pointer rounded-sm border border-rule bg-surface px-3 text-label transition-colors duration-[80ms] hover:border-signal"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
