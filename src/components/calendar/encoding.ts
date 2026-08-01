import { generatesLink } from '@/lib/meetings/schema'
import type { MeetingDto } from './types'

/**
 * The design's encoding rules (§5). These carry meaning and are not styling
 * choices, so they live in one place rather than being re-derived per view.
 *
 * The primary distinction is **link vs no link**, not platform: Google Meet
 * and WhatsApp have near-identical brand greens, so hue is useless here.
 * Fill and border style carry it instead — which also means the encoding
 * survives colour blindness, since it never relies on hue alone (§9).
 */
export type MeetingState = 'live' | 'soon' | 'past' | 'cancelled' | 'upcoming'

/** Within this many minutes of starting, a meeting reads as time-critical. */
export const SOON_MINUTES = 30

export function meetingState(m: MeetingDto, now: Date): MeetingState {
  if (m.status === 'cancelled') return 'cancelled'
  const start = new Date(m.startsAt).getTime()
  const end = new Date(m.endsAt).getTime()
  const t = now.getTime()

  if (t >= start && t < end) return 'live'
  if (t >= end) return 'past'
  if (start - t <= SOON_MINUTES * 60_000) return 'soon'
  return 'upcoming'
}

export interface BlockStyle {
  background: string
  borderLeft: string
  border: string
  opacity: number
  textDecoration: 'line-through' | 'none'
}

export function blockStyle(m: MeetingDto, state: MeetingState): BlockStyle {
  if (state === 'cancelled') {
    return {
      background: 'var(--surface)',
      // No left border: a cancelled meeting has stopped asserting anything.
      borderLeft: 'none',
      border: '1px solid var(--rule)',
      opacity: 0.4,
      textDecoration: 'line-through',
    }
  }

  if (state === 'live') {
    return {
      background: 'var(--fill-live)',
      borderLeft: '2px solid var(--live)',
      border: '1px solid transparent',
      opacity: 1,
      textDecoration: 'none',
    }
  }

  if (generatesLink(m.conferencingProvider)) {
    return {
      background: 'var(--fill-signal)',
      borderLeft: '2px solid var(--signal)',
      border: '1px solid transparent',
      opacity: state === 'past' ? 0.45 : 1,
      textDecoration: 'none',
    }
  }

  return {
    background: 'var(--paper)',
    // Dashed: the absence of a link is deliberate, not broken.
    borderLeft: '2px dashed var(--slate)',
    border: '1px solid var(--rule)',
    opacity: state === 'past' ? 0.45 : 1,
    textDecoration: 'none',
  }
}

/** Magenta is reserved for time-criticality — four states, no others (§3). */
export function isTimeCritical(state: MeetingState): boolean {
  return state === 'live' || state === 'soon'
}
