import { describe, expect, it } from 'vitest'
import { EXAMPLES, parse } from '@/lib/assistant/parse'

/**
 * The grammar is the whole reason this assistant costs nothing to run, and
 * the whole reason it can be wrong in a way a model cannot: a model
 * misunderstands visibly, a regex misunderstands confidently. So every
 * phrasing it claims to accept is pinned here, and so is the boundary where
 * it stops claiming.
 */

const intent = (input: string) => {
  const r = parse(input)
  if (!r.ok) throw new Error(`expected a parse, got: ${r.reason}`)
  return r.intent
}

const refusal = (input: string) => {
  const r = parse(input)
  if (r.ok) throw new Error(`expected a refusal, got: ${JSON.stringify(r.intent)}`)
  return r.reason
}

describe('every advertised example parses', () => {
  // The panel offers these as buttons. One that does not parse is a button
  // that fails when clicked.
  for (const example of EXAMPLES) {
    it(`"${example}"`, () => {
      expect(parse(example).ok).toBe(true)
    })
  }
})

describe('listing', () => {
  it('reads the day being asked about', () => {
    expect(intent("What's on today?")).toEqual({ kind: 'list', range: 'today' })
    expect(intent('what have i got tomorrow')).toEqual({ kind: 'list', range: 'tomorrow' })
    expect(intent('show me this week')).toEqual({ kind: 'list', range: 'this-week' })
    expect(intent('what do i have next week')).toEqual({ kind: 'list', range: 'next-week' })
  })

  it('defaults to today when no day is named', () => {
    expect(intent("what's on")).toEqual({ kind: 'list', range: 'today' })
  })

  it('survives a phone keyboard', () => {
    // U+2019, not U+0027. Half of real input arrives this way.
    expect(intent('what’s on tomorrow')).toEqual({ kind: 'list', range: 'tomorrow' })
  })
})

describe('finding time', () => {
  it('reads the duration', () => {
    expect(intent('find an hour next week')).toMatchObject({
      kind: 'free',
      durationMinutes: 60,
      range: 'next-week',
    })
    expect(intent('find 30 minutes tomorrow')).toMatchObject({ durationMinutes: 30 })
    expect(intent('find half an hour this week')).toMatchObject({ durationMinutes: 30 })
    expect(intent('when is everyone free for 45 mins')).toMatchObject({ durationMinutes: 45 })
    expect(intent('find 2 hours next week')).toMatchObject({ durationMinutes: 120 })
  })

  it('defaults to an hour', () => {
    expect(intent('when is the team free')).toMatchObject({ durationMinutes: 60 })
  })

  it('distinguishes the whole team from just me', () => {
    expect(intent('find an hour when everyone is free')).toMatchObject({ withWholeTeam: true })
    expect(intent('find an hour for the team next week')).toMatchObject({ withWholeTeam: true })
    expect(intent('when am i free tomorrow')).toMatchObject({ withWholeTeam: false })
  })

  it('does not read a duration as a clock time', () => {
    // "30 minutes" must not become 00:30. This is the failure that would
    // make the feature quietly useless rather than visibly broken.
    expect(intent('find 30 minutes next week')).toMatchObject({
      kind: 'free',
      durationMinutes: 30,
    })
  })
})

describe('moving', () => {
  it('takes a day and a time', () => {
    expect(intent('move the miniz review to thursday at 3pm')).toEqual({
      kind: 'move',
      ref: { kind: 'title', text: 'miniz review' },
      when: { day: { kind: 'weekday', weekday: 4, next: false }, time: { hour: 15, minute: 0 } },
    })
  })

  it('takes a day alone, keeping the time', () => {
    expect(intent('move the miniz review to thursday')).toMatchObject({
      when: { day: { kind: 'weekday', weekday: 4, next: false }, time: null },
    })
  })

  it('takes a time alone, keeping the day', () => {
    expect(intent('move the miniz review to 4pm')).toMatchObject({
      when: { day: null, time: { hour: 16, minute: 0 } },
    })
  })

  it('reads a bare hour as the working afternoon', () => {
    // "move it to 3" in an office means 15:00. Nobody schedules 03:00.
    expect(intent('move the review to 3')).toMatchObject({
      when: { time: { hour: 15, minute: 0 } },
    })
    // But an explicit morning hour is respected.
    expect(intent('move the review to 9am')).toMatchObject({
      when: { time: { hour: 9, minute: 0 } },
    })
    expect(intent('move the review to 11am')).toMatchObject({
      when: { time: { hour: 11, minute: 0 } },
    })
  })

  it('understands parts of the day', () => {
    expect(intent('move the review to tomorrow morning')).toMatchObject({
      when: { day: { kind: 'tomorrow' }, time: { hour: 10, minute: 0 } },
    })
    expect(intent('move the review to friday afternoon')).toMatchObject({
      when: { day: { kind: 'weekday', weekday: 5, next: false }, time: { hour: 15, minute: 0 } },
    })
  })

  it('distinguishes this thursday from next thursday', () => {
    expect(intent('move the review to next thursday')).toMatchObject({
      when: { day: { kind: 'weekday', weekday: 4, next: true } },
    })
  })

  it('accepts the words people actually use', () => {
    for (const verb of ['move', 'reschedule', 'shift', 'push', 'bump', 'change']) {
      expect(intent(`${verb} the review to friday`)).toMatchObject({ kind: 'move' })
    }
  })

  it('handles minutes', () => {
    expect(intent('move the review to 2:30pm')).toMatchObject({
      when: { time: { hour: 14, minute: 30 } },
    })
    expect(intent('move the review to 09:45')).toMatchObject({
      when: { time: { hour: 9, minute: 45 } },
    })
  })

  it('refuses rather than guessing when the time is missing', () => {
    expect(refusal('move the miniz review to somewhere else')).toMatch(/didn't catch the new time/)
  })

  it('resolves "my next meeting"', () => {
    expect(intent('move my next meeting to tomorrow')).toMatchObject({
      ref: { kind: 'next', clientOnly: false },
    })
    expect(intent('move my next client call to tomorrow')).toMatchObject({
      ref: { kind: 'next', clientOnly: true },
    })
  })
})

describe('cancelling', () => {
  it('takes a meeting', () => {
    expect(intent('cancel the miniz review')).toEqual({
      kind: 'cancel',
      ref: { kind: 'title', text: 'miniz review' },
      reason: '',
    })
  })

  it('keeps a reason when one is given', () => {
    expect(intent('cancel the miniz review because the client rescheduled')).toMatchObject({
      kind: 'cancel',
      reason: 'the client rescheduled',
    })
  })

  it('works on the next meeting', () => {
    expect(intent('cancel my next client call')).toMatchObject({
      ref: { kind: 'next', clientOnly: true },
    })
  })
})

describe('reassigning', () => {
  it('reads swap X for Y on Z', () => {
    expect(intent('swap priya for arjun on the miniz review')).toEqual({
      kind: 'reassign',
      fromName: 'priya',
      toName: 'arjun',
      ref: { kind: 'title', text: 'miniz review' },
    })
  })

  it('reads put X on Z instead of Y', () => {
    expect(intent('put arjun on the miniz review instead of priya')).toMatchObject({
      fromName: 'priya',
      toName: 'arjun',
    })
  })

  it('does not confuse the direction', () => {
    // Getting this backwards removes the wrong person from a meeting. The
    // confirmation card would show it, but it should not get that far.
    const swap = intent('swap priya for arjun on the review')
    const instead = intent('put arjun on the review instead of priya')
    expect(swap).toMatchObject({ fromName: 'priya', toName: 'arjun' })
    expect(instead).toMatchObject({ fromName: 'priya', toName: 'arjun' })
  })
})

describe('messaging', () => {
  it('takes a person and a message', () => {
    expect(intent('tell priya the review moved to thursday')).toEqual({
      kind: 'notify',
      toName: 'priya',
      message: 'the review moved to thursday',
    })
  })

  it('accepts the other verbs', () => {
    for (const verb of ['tell', 'message', 'dm', 'ping']) {
      expect(intent(`${verb} arjun the call is off`)).toMatchObject({ kind: 'notify' })
    }
  })

  it('refuses an empty message', () => {
    expect(refusal('tell priya')).toBeTruthy()
  })
})

describe('the boundary', () => {
  it('says so plainly, and shows what it can do', () => {
    const reason = refusal('shuffle things around so i get a clear morning')
    expect(reason).toMatch(/didn't follow that/)
  })

  it.each([
    'summarise my week and tell me what to drop',
    'book a meeting with the client next tuesday',
    'who is the busiest person this week',
    'delete everything',
    'why is the sky blue',
  ])('refuses "%s" rather than guessing', (input) => {
    expect(parse(input).ok).toBe(false)
  })

  it('refuses an empty prompt', () => {
    expect(refusal('   ')).toBe('Say what you need.')
  })

  it('never stages anything from a refusal', () => {
    // A refusal has no intent at all, so there is no path from "I did not
    // understand" to a confirmation card.
    const r = parse('do something clever')
    expect(r.ok).toBe(false)
    expect(r).not.toHaveProperty('intent')
  })
})
