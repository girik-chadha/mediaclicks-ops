/**
 * The sign-in greeting: its clock, and the one line of context under the name.
 *
 * Pure, so the timings the handoff fixed are pinned by a test rather than by
 * whoever last edited the component, and so the subline's three cases can be
 * proved without mounting anything.
 */

/**
 * The three states, driven by one variable.
 *
 *  - `idle`  — no overlay. The resting state, before and after.
 *  - `greet` — the name is up, Home is blurred underneath.
 *  - `in`    — the veil is clearing and Home's blocks are rising, at the same
 *              time rather than one after the other.
 */
export type GreetPhase = 'idle' | 'greet' | 'in'

/** How long the name holds before the veil starts clearing. */
export const GREET_MS = 1250

/** How long the clearing takes. 1250 + 680 = 1930ms, click to interactive. */
export const IN_MS = 680

export const TOTAL_MS = GREET_MS + IN_MS

/** The staggered Home blocks, in order, with the handoff's delays. */
export const RISE_DELAYS_MS = [0, 60, 120, 180] as const
export const RISE_MS = 320
export const HOME_FADE_MS = 260

/** What the greeting needs to know about a meeting. Deliberately minimal:
 *  this takes the values Home has already derived rather than re-deriving
 *  them, so the two cannot disagree about whether something is live. */
export interface GreetMeeting {
  readonly title: string
  readonly startsAt: string | Date
  readonly endsAt: string | Date
}

const ms = (v: string | Date): number =>
  typeof v === 'string' ? new Date(v).getTime() : v.getTime()

/**
 * The line under the name.
 *
 * Three cases, in the handoff's order. `remaining` is the same array Home's
 * header counts, and `now` the same reference instant, so "2 meetings left
 * today" here and "2 left today" in the stat block are the same claim rather
 * than two answers computed a few milliseconds apart.
 *
 * `formatTime` is passed in rather than imported so this stays pure and the
 * caller keeps ownership of the person's timezone — the whole app renders
 * times through the stored zone, and a greeting that quietly used the
 * browser's would be the one place that lied.
 */
export function greetingSubline(
  remaining: readonly GreetMeeting[],
  now: Date,
  formatTime: (d: Date) => string,
): string {
  const at = now.getTime()

  const running = remaining.find((m) => ms(m.startsAt) <= at && ms(m.endsAt) > at)
  if (running) {
    return `${running.title} is running until ${formatTime(new Date(ms(running.endsAt)))}.`
  }

  const upcoming = remaining.filter((m) => ms(m.startsAt) > at)
  if (upcoming.length === 0) return "Nothing left on today's list."

  const soonest = upcoming.reduce((a, b) => (ms(a.startsAt) <= ms(b.startsAt) ? a : b))
  const n = upcoming.length
  return `${n} meeting${n === 1 ? '' : 's'} left today. Next at ${formatTime(new Date(ms(soonest.startsAt)))}.`
}
