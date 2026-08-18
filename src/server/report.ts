import 'server-only'

/**
 * Records a failure nobody anticipated.
 *
 * Every action in this app converts an unexpected error into a short
 * sentence for the reader — "That did not send. Try again." — which is the
 * right thing to show and, on its own, was the wrong thing to do. The
 * message went to the person, who cannot act on it, and the error went
 * nowhere at all.
 *
 * That cost a full afternoon once already. `getMeeting` asked Postgres for
 * every meeting between 1970 and the year 275760; Postgres rejected the
 * parameter, every edit and cancellation failed before touching a row, and
 * the only evidence anywhere was six words in a modal. The fix took minutes
 * once the error was visible. Finding it took days of guessing because it
 * was not.
 *
 * So: expected failures — a permission refusal, a validation message — are
 * written for the reader and must not come through here. Anything else is a
 * defect, and a defect that logs nothing is a defect nobody can fix.
 *
 * console.error rather than a logging library: it reaches the terminal in
 * development and the platform's log drain in production, which is every
 * place it currently needs to reach. One function so that changing that
 * later is one edit.
 */
export function reportUnexpected(scope: string, error: unknown): void {
  console.error(`[${scope}] unexpected failure:`, error)
}
