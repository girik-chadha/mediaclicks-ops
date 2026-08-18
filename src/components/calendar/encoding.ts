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
  /** Ready-composed, for the views that never vary the width. */
  borderLeft: string
  /**
   * The same rule in parts.
   *
   * The week grid thickens the left border on hover, and doing that by
   * setting `borderLeftWidth` beside a `borderLeft` shorthand mixes the two
   * forms for one property — React warns about it and the result depends on
   * key order rather than on anything intentional. Handing back the pieces
   * lets a caller compose its own shorthand instead.
   */
  borderLeftStyle: 'solid' | 'dashed' | 'none'
  borderLeftColor: string
  /** Width when nothing is hovering it. */
  borderLeftWidth: number
  border: string
  opacity: number
  textDecoration: 'line-through' | 'none'
}

/** Composes the shorthand, so the parts and the whole cannot disagree. */
export function leftRule(
  style: Pick<BlockStyle, 'borderLeftStyle' | 'borderLeftColor'>,
  width: number,
): string {
  return `${width}px ${style.borderLeftStyle} ${style.borderLeftColor}`
}

export function blockStyle(m: MeetingDto, state: MeetingState): BlockStyle {
  if (state === 'cancelled') {
    return withRule({
      background: 'var(--surface)',
      // No left border: a cancelled meeting has stopped asserting anything.
      borderLeftStyle: 'none',
      borderLeftColor: 'transparent',
      borderLeftWidth: 0,
      border: '1px solid var(--rule)',
      opacity: 0.4,
      textDecoration: 'line-through',
    })
  }

  if (state === 'live') {
    return withRule({
      background: 'var(--fill-live)',
      borderLeftStyle: 'solid',
      borderLeftColor: 'var(--live)',
      borderLeftWidth: 2,
      border: '1px solid transparent',
      opacity: 1,
      textDecoration: 'none',
    })
  }

  if (generatesLink(m.conferencingProvider)) {
    return withRule({
      background: 'var(--fill-signal)',
      borderLeftStyle: 'solid',
      borderLeftColor: 'var(--signal)',
      borderLeftWidth: 2,
      border: '1px solid transparent',
      opacity: state === 'past' ? 0.45 : 1,
      textDecoration: 'none',
    })
  }

  return withRule({
    background: 'var(--paper)',
    // Dashed: the absence of a link is deliberate, not broken.
    borderLeftStyle: 'dashed',
    borderLeftColor: 'var(--slate)',
    borderLeftWidth: 2,
    border: '1px solid var(--rule)',
    opacity: state === 'past' ? 0.45 : 1,
    textDecoration: 'none',
  })
}

const withRule = (style: Omit<BlockStyle, 'borderLeft'>): BlockStyle => ({
  ...style,
  borderLeft: leftRule(style, style.borderLeftWidth),
})

/** Magenta is reserved for time-criticality — four states, no others (§3). */
export function isTimeCritical(state: MeetingState): boolean {
  return state === 'live' || state === 'soon'
}
