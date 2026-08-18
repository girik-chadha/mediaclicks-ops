import { describe, expect, it } from 'vitest'
import { MAX_DURATION_MINUTES, parseDuration, takeTimeRange } from '@/lib/assistant/when'
import { answerTime, parse } from '@/lib/assistant/parse'

/**
 * How long a meeting is.
 *
 * The grammar used to read only the *start* of a request, so "tomorrow 6pm
 * to 7pm" booked thirty minutes and rendered a confirmation card that
 * looked entirely correct. That is the failure mode ADR 0007 singles out —
 * a regex misunderstanding confidently — so both halves of the fix are
 * pinned here: the span parser itself, and the two paths a request can take
 * to reach it.
 */

/** The staged length for a sentence, via the schedule matcher. */
function durationOf(sentence: string): number | null {
  const result = parse(sentence)
  if (!result.ok || result.intent.kind !== 'schedule') return null
  return result.intent.durationMinutes
}

/** The start time the same sentence resolves to, as "HH:MM". */
function startOf(sentence: string): string | null {
  const result = parse(sentence)
  if (!result.ok || result.intent.kind !== 'schedule') return null
  const t = result.intent.when.time
  return t ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` : null
}

describe('a named length', () => {
  it('reads the forms people actually type', () => {
    expect(parseDuration('15 minutes')).toBe(15)
    expect(parseDuration('30 mins')).toBe(30)
    expect(parseDuration('45 min')).toBe(45)
    expect(parseDuration('90 minutes')).toBe(90)
    expect(parseDuration('an hour')).toBe(60)
    expect(parseDuration('half an hour')).toBe(30)
    expect(parseDuration('2 hours')).toBe(120)
    expect(parseDuration('2h')).toBe(120)
    expect(parseDuration('3 hrs')).toBe(180)
  })

  it('reads a spelled-out number, because sentences are not form fields', () => {
    expect(parseDuration('two hours')).toBe(120)
    expect(parseDuration('three hours')).toBe(180)
    expect(parseDuration('ten minutes')).toBe(10)
  })

  /** English puts "and a half" on either side of the unit. Both are read. */
  it('reads a half hour without dropping it', () => {
    expect(parseDuration('an hour and a half')).toBe(90)
    expect(parseDuration('two hours and a half')).toBe(150)
    expect(parseDuration('two and a half hours')).toBe(150)
    expect(parseDuration('1.5 hours')).toBe(90)
    expect(parseDuration('2.5 hrs')).toBe(150)
  })

  it('reads the combined form', () => {
    expect(parseDuration('1h30')).toBe(90)
    expect(parseDuration('2h15m')).toBe(135)
  })

  /**
   * The server refuses more than twelve hours, so accepting it here would
   * stage a card that fails on Confirm — a worse outcome than not
   * understanding, because the person has already agreed to it by then.
   */
  it('refuses a length the server would reject', () => {
    expect(parseDuration('13 hours')).toBeNull()
    expect(parseDuration('900 minutes')).toBeNull()
    expect(parseDuration('12 hours')).toBe(MAX_DURATION_MINUTES)
  })

  /**
   * "a" glued to "min" is a substring of a real first name. Digits may be
   * glued to their unit; words may not, which is what keeps a meeting with
   * Amin from becoming a one-minute meeting with nobody.
   */
  it('does not find a length inside a name', () => {
    expect(parseDuration('amin')).toBeNull()
    expect(parseDuration('with amin')).toBeNull()
    expect(parseDuration('minaz')).toBeNull()
    // The glued digit form still works, because that is how people write it.
    expect(parseDuration('2h')).toBe(120)
    expect(parseDuration('30m')).toBe(30)
  })
})

describe('a span', () => {
  const span = (text: string) => {
    const found = takeTimeRange(text)
    if (!found) return null
    const { start, end, durationMinutes } = found.range
    return {
      from: `${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}`,
      to: `${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}`,
      durationMinutes,
    }
  }

  it('reads both ends when both carry a meridiem', () => {
    expect(span('6pm to 7pm')).toEqual({ from: '18:00', to: '19:00', durationMinutes: 60 })
    expect(span('9am to 11am')).toEqual({ from: '09:00', to: '11:00', durationMinutes: 120 })
  })

  it('reads the separators people use', () => {
    expect(span('6pm - 7pm')?.durationMinutes).toBe(60)
    expect(span('6pm-7pm')?.durationMinutes).toBe(60)
    expect(span('from 9am until 11am')?.durationMinutes).toBe(120)
    expect(span('9am till 10am')?.durationMinutes).toBe(60)
    expect(span('between 2pm and 3pm')?.durationMinutes).toBe(60)
  })

  it('reads 24-hour times', () => {
    expect(span('18:00-19:00')).toEqual({ from: '18:00', to: '19:00', durationMinutes: 60 })
    expect(span('14:00 to 15:30')).toEqual({ from: '14:00', to: '15:30', durationMinutes: 90 })
  })

  it('carries a meridiem across when only one end states it', () => {
    expect(span('6 to 7pm')).toEqual({ from: '18:00', to: '19:00', durationMinutes: 60 })
    expect(span('3pm to 5')).toEqual({ from: '15:00', to: '17:00', durationMinutes: 120 })
  })

  /**
   * The case that cannot be decided one end at a time: 11 is the morning
   * only because 1pm is the afternoon.
   */
  it('lets the two ends take different halves of the day', () => {
    expect(span('11 to 1pm')).toEqual({ from: '11:00', to: '13:00', durationMinutes: 120 })
    expect(span('11am to 2pm')?.durationMinutes).toBe(180)
  })

  it('reads a bare pair the way the rest of the grammar reads a bare hour', () => {
    // takeTimeOfDay sends a bare 1-7 to the afternoon; this agrees with it
    // rather than offering a second answer to the same question.
    expect(span('6 to 7')).toEqual({ from: '18:00', to: '19:00', durationMinutes: 60 })
    expect(span('10 to 11')).toEqual({ from: '10:00', to: '11:00', durationMinutes: 60 })
  })

  it('handles minutes on either end', () => {
    expect(span('2:30pm to 4pm')?.durationMinutes).toBe(90)
    expect(span('9 to 9:15am')?.durationMinutes).toBe(15)
  })

  it('is not fooled by a list of names', () => {
    expect(takeTimeRange('with priya and arjun')).toBeNull()
    expect(takeTimeRange('with emma girik lina')).toBeNull()
  })

  it('refuses a backwards or absurd span rather than guessing', () => {
    expect(takeTimeRange('19:00 to 18:00')).toBeNull()
    expect(takeTimeRange('99 to 101')).toBeNull()
  })
})

describe('booking a meeting of a stated length', () => {
  it('honours a span in the original sentence', () => {
    expect(durationOf('schedule a call with priya tomorrow 6pm to 7pm')).toBe(60)
    expect(startOf('schedule a call with priya tomorrow 6pm to 7pm')).toBe('18:00')
  })

  it('honours the lengths the request asked about', () => {
    expect(durationOf('schedule a call with priya tomorrow at 3pm for 15 minutes')).toBe(15)
    expect(durationOf('schedule a call with priya tomorrow at 3pm for an hour')).toBe(60)
    expect(durationOf('schedule a call with priya tomorrow at 3pm for 2 hours')).toBe(120)
    expect(durationOf('book 90 minutes with priya tomorrow at 3pm')).toBe(90)
  })

  it('still defaults to thirty minutes when nothing was said', () => {
    expect(durationOf('schedule a call with priya tomorrow at 3pm')).toBe(30)
  })

  /** A span names both ends, so it settles the length on its own. */
  it('prefers the span when a length is also named', () => {
    expect(durationOf('book 30 minutes with priya tomorrow 6pm to 8pm')).toBe(120)
  })

  it('does not read a duration as a clock time', () => {
    // The regression the ordering in the schedule matcher exists to prevent.
    expect(startOf('schedule a call with priya tomorrow at 3pm for 30 minutes')).toBe('15:00')
  })
})

describe('answering “what time?”', () => {
  it('takes the length from a span, which is the reported bug', () => {
    const answer = answerTime('tomorrow 6pm to 7pm')
    expect(answer?.time).toEqual({ hour: 18, minute: 0 })
    expect(answer?.durationMinutes).toBe(60)
  })

  it('takes a length stated on its own', () => {
    expect(answerTime('tomorrow at 3pm for 2 hours')?.durationMinutes).toBe(120)
  })

  it('leaves the length alone when only a start was given', () => {
    const answer = answerTime('3pm')
    expect(answer?.time).toEqual({ hour: 15, minute: 0 })
    // Null, not 30: the planner keeps whatever was carried, so an answer to
    // a later question cannot quietly reset a length given earlier.
    expect(answer?.durationMinutes).toBeNull()
  })

  it('still reads a bare hour as a clock time', () => {
    expect(answerTime('4')?.time).toEqual({ hour: 16, minute: 0 })
  })
})
