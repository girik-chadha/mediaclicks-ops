import { describe, expect, it } from 'vitest'
import {
  GREET_MS,
  IN_MS,
  RISE_DELAYS_MS,
  TOTAL_MS,
  greetingSubline,
} from '@/lib/home/greeting'

/**
 * The greeting's timings and its one line of copy.
 *
 * The timings are pinned because the handoff called them final and they are
 * otherwise four loose numbers nobody would notice drifting. The subline is
 * pinned because it makes a factual claim about the person's day, next to a
 * stat block making the same claim — the two disagreeing is the failure
 * worth engineering against.
 */

const at = (iso: string) => new Date(iso)
const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

describe('sequence timing', () => {
  it('holds the name, then clears, for the handoff’s 1930ms', () => {
    expect(GREET_MS).toBe(1250)
    expect(IN_MS).toBe(680)
    expect(TOTAL_MS).toBe(1930)
  })

  it('staggers the four blocks 60ms apart', () => {
    expect([...RISE_DELAYS_MS]).toEqual([0, 60, 120, 180])
  })

  it('finishes the last block before the sequence ends', () => {
    // 1250 + 180 delay + 320 duration = 1750, inside 1930. If a future edit
    // lengthened the stagger past the phase, the last section would still be
    // mid-animation when the overlay unmounted and the animation was cleared.
    const lastFinishes = GREET_MS + RISE_DELAYS_MS[3] + 320
    expect(lastFinishes).toBeLessThanOrEqual(TOTAL_MS)
  })
})

describe('the line under the name', () => {
  const now = at('2026-09-09T14:00:00Z')

  it('names the meeting that is running right now', () => {
    const subline = greetingSubline(
      [
        { title: 'Campaign review', startsAt: '2026-09-09T13:40:00Z', endsAt: '2026-09-09T14:25:00Z' },
        { title: 'Weekly planning', startsAt: '2026-09-09T15:00:00Z', endsAt: '2026-09-09T15:30:00Z' },
      ],
      now,
      hhmm,
    )
    expect(subline).toBe('Campaign review is running until 14:25.')
  })

  it('counts what is left when nothing is running', () => {
    const subline = greetingSubline(
      [
        { title: 'Weekly planning', startsAt: '2026-09-09T15:00:00Z', endsAt: '2026-09-09T15:30:00Z' },
        { title: 'Creative handover', startsAt: '2026-09-09T16:00:00Z', endsAt: '2026-09-09T16:30:00Z' },
      ],
      now,
      hhmm,
    )
    expect(subline).toBe('2 meetings left today. Next at 15:00.')
  })

  it('says "meeting", singular, when there is one', () => {
    const subline = greetingSubline(
      [{ title: 'Weekly planning', startsAt: '2026-09-09T15:00:00Z', endsAt: '2026-09-09T15:30:00Z' }],
      now,
      hhmm,
    )
    expect(subline).toBe('1 meeting left today. Next at 15:00.')
  })

  it('takes the soonest as "next", not the first in the array', () => {
    const subline = greetingSubline(
      [
        { title: 'Later', startsAt: '2026-09-09T17:00:00Z', endsAt: '2026-09-09T17:30:00Z' },
        { title: 'Sooner', startsAt: '2026-09-09T15:00:00Z', endsAt: '2026-09-09T15:30:00Z' },
      ],
      now,
      hhmm,
    )
    expect(subline).toBe('2 meetings left today. Next at 15:00.')
  })

  it('has something to say on an empty day', () => {
    expect(greetingSubline([], now, hhmm)).toBe("Nothing left on today's list.")
  })

  it('prefers the running meeting even when others remain', () => {
    // Both branches are true here. Getting the order wrong would report "1
    // meeting left today" while the person is sitting in a call.
    const subline = greetingSubline(
      [
        { title: 'In progress', startsAt: '2026-09-09T13:00:00Z', endsAt: '2026-09-09T14:30:00Z' },
        { title: 'Later', startsAt: '2026-09-09T16:00:00Z', endsAt: '2026-09-09T16:30:00Z' },
      ],
      now,
      hhmm,
    )
    expect(subline).toBe('In progress is running until 14:30.')
  })

  it('treats a meeting that ended a moment ago as over, not running', () => {
    const subline = greetingSubline(
      [{ title: 'Just finished', startsAt: '2026-09-09T13:00:00Z', endsAt: '2026-09-09T14:00:00Z' }],
      now,
      hhmm,
    )
    expect(subline).toBe("Nothing left on today's list.")
  })

  it('accepts Date objects as well as ISO strings', () => {
    const subline = greetingSubline(
      [{ title: 'Campaign review', startsAt: at('2026-09-09T13:40:00Z'), endsAt: at('2026-09-09T14:25:00Z') }],
      now,
      hhmm,
    )
    expect(subline).toBe('Campaign review is running until 14:25.')
  })
})
