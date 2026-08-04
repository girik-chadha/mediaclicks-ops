import { describe, expect, it } from 'vitest'
import {
  answerIsDecline,
  answerNames,
  answerProvider,
  answerTime,
  answerUrl,
  parse,
  STARTERS,
} from '@/lib/assistant/parse'

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

describe('every advertised starter parses', () => {
  // The panel offers these as buttons. One that does not parse is a button
  // that fails when clicked.
  for (const example of STARTERS) {
    it(`"${example}"`, () => {
      expect(parse(example).ok).toBe(true)
    })
  }
})

describe('listing', () => {
  it('reads the day being asked about', () => {
    expect(intent("What's on today?")).toEqual({ kind: 'list', ranges: ['today'] })
    expect(intent('what have i got tomorrow')).toEqual({ kind: 'list', ranges: ['tomorrow'] })
    expect(intent('show me this week')).toEqual({ kind: 'list', ranges: ['this-week'] })
    expect(intent('what do i have next week')).toEqual({ kind: 'list', ranges: ['next-week'] })
  })

  it('defaults to today when no day is named', () => {
    expect(intent("what's on")).toEqual({ kind: 'list', ranges: ['today'] })
  })

  it('survives a phone keyboard', () => {
    // U+2019, not U+0027. Half of real input arrives this way.
    expect(intent('what’s on tomorrow')).toEqual({ kind: 'list', ranges: ['tomorrow'] })
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

describe('scheduling something new', () => {
  it('reads the request that started all this', () => {
    // Verbatim from the user who found the gap. Politeness, a bare time, a
    // client, and the platform buried mid-sentence.
    expect(intent('can u schedule a meeting at 3pm with miniz it will be a whatsapp call')).toEqual({
      kind: 'schedule',
      withNames: ['miniz'],
      when: { day: null, time: { hour: 15, minute: 0 } },
      durationMinutes: 30,
      provider: 'whatsapp',
      title: '',
      url: '',
    })
  })

  it('strips politeness for every intent, not just this one', () => {
    expect(intent('can you cancel my next client call')).toMatchObject({ kind: 'cancel' })
    expect(intent('please move the review to friday')).toMatchObject({ kind: 'move' })
    expect(intent("i'd like to know what's on tomorrow")).toMatchObject({ kind: 'list' })
  })

  it('accepts the openers people use', () => {
    for (const opener of ['schedule', 'book', 'set up', 'arrange', 'organise']) {
      expect(intent(`${opener} a call with priya tomorrow at 3pm`)).toMatchObject({
        kind: 'schedule',
      })
    }
    expect(intent('new meeting with priya tomorrow at 3pm')).toMatchObject({ kind: 'schedule' })
  })

  it('reads several people', () => {
    expect(intent('book 30 minutes with priya and arjun on friday at 2pm')).toMatchObject({
      withNames: ['priya', 'arjun'],
      durationMinutes: 30,
    })
  })

  it('does not let slot debris into a name', () => {
    // Removing "whatsapp" leaves "call"; removing "friday" leaves "on".
    // Either one riding along stops the name matching anything.
    expect(intent('schedule a whatsapp call with the miniz team tomorrow at 3pm')).toMatchObject({
      withNames: ['miniz'],
    })
    expect(intent('book a call with arjun on friday at 2pm')).toMatchObject({
      withNames: ['arjun'],
    })
  })

  it('reads every platform, and none when unsaid', () => {
    const at = 'with priya tomorrow at 3pm'
    expect(intent(`schedule a whatsapp call ${at}`)).toMatchObject({ provider: 'whatsapp' })
    expect(intent(`schedule a zoom ${at}`)).toMatchObject({ provider: 'zoom' })
    expect(intent(`schedule a google meet ${at}`)).toMatchObject({ provider: 'google_meet' })
    expect(intent(`schedule a call ${at}`)).toMatchObject({ provider: null })
  })

  it('keeps a pasted link', () => {
    expect(intent('set up a zoom with miniz thursday at 11am https://zoom.us/j/123')).toMatchObject(
      { provider: 'zoom', url: 'https://zoom.us/j/123' },
    )
  })

  it('takes a title from "about", but never from "for"', () => {
    expect(intent('book a call with priya tomorrow at 3pm about the campaign')).toMatchObject({
      title: 'campaign',
    })
    // "for tomorrow at 3pm" is a time, not a title. Reading it as one would
    // create a meeting literally called "tomorrow at 3pm with priya".
    expect(intent('schedule a call for tomorrow at 3pm with priya')).toMatchObject({
      title: '',
      when: { day: { kind: 'tomorrow' }, time: { hour: 15, minute: 0 } },
    })
  })

  it('defaults to half an hour', () => {
    expect(intent('schedule a call with priya tomorrow at 3pm')).toMatchObject({
      durationMinutes: 30,
    })
  })

  it('carries a half-specified request instead of refusing it', () => {
    // The gaps are real, but a gap is not a misunderstanding. The parser
    // reports what it heard and the planner asks for the rest — refusing
    // here would make the person retype the whole sentence with the missing
    // word wedged in.
    expect(intent('schedule a call with miniz')).toMatchObject({
      kind: 'schedule',
      withNames: ['miniz'],
      when: { time: null },
    })
    expect(intent('schedule a meeting at 3pm')).toMatchObject({
      kind: 'schedule',
      withNames: [],
      when: { time: { hour: 15, minute: 0 } },
    })
    // A booking request with a day but no time is still a booking request.
    expect(intent('book a meeting with the client next tuesday')).toMatchObject({
      kind: 'schedule',
      when: { time: null },
    })
  })
})

describe('the same question, asked differently', () => {
  // The complaint that produced this block: "give me a rundown of all the
  // meetings today and tomorrow" was refused while "what's on today" worked.
  // Matchers used to anchor to the first word, which is a distinction nobody
  // asking the question would recognise.
  it.each([
    'give me a rundown of all the meetings today and tomorrow',
    'whats my day looking like',
    'do i have anything tomorrow',
    'give me an overview of next week',
    'remind me what i have on this week',
    'whats coming up this week',
    'can u tell me my schedule for tomorrow',
  ])('reads "%s" as a question about the calendar', (input) => {
    expect(intent(input)).toMatchObject({ kind: 'list' })
  })

  it('unions every range named, not just the first', () => {
    // Answering only "today" would drop half of what was asked for — the
    // kind of wrong that looks like a right answer.
    expect(intent('the meetings today and tomorrow')).toMatchObject({
      ranges: ['today', 'tomorrow'],
    })
  })

  it('tells the noun "schedule" from the verb', () => {
    // "my schedule" is a question; "schedule a call" is an instruction. A
    // determiner in front is the only thing separating them.
    expect(intent('whats my schedule this week')).toMatchObject({ kind: 'list' })
    expect(intent('show me the schedule')).toMatchObject({ kind: 'list' })
    expect(intent('schedule a call with priya tomorrow at 3pm')).toMatchObject({
      kind: 'schedule',
    })
  })

  it.each([
    'i need you to move the design crit to monday at 11am',
    'can you book a call with kite airlines on thursday at 4pm',
  ])('finds the verb mid-sentence: "%s"', (input) => {
    expect(parse(input).ok).toBe(true)
  })
})

describe('answering a question the assistant asked', () => {
  it('reads a bare time', () => {
    expect(answerTime('3pm')).toEqual({ day: null, time: { hour: 15, minute: 0 } })
    expect(answerTime('tomorrow at 10am')).toEqual({
      day: { kind: 'tomorrow' },
      time: { hour: 10, minute: 0 },
    })
    expect(answerTime('friday morning')).toEqual({
      day: { kind: 'weekday', weekday: 5, next: false },
      time: { hour: 10, minute: 0 },
    })
    expect(answerTime('whenever')).toBeNull()
  })

  it('reads a bare platform', () => {
    expect(answerProvider('zoom')).toBe('zoom')
    expect(answerProvider('whatsapp')).toBe('whatsapp')
    expect(answerProvider('google meet')).toBe('google_meet')
    expect(answerProvider('lets do it on meet')).toBe('google_meet')
    expect(answerProvider('none')).toBe('none')
    expect(answerProvider('dunno')).toBeNull()
  })

  it('hands the whole phrase on rather than splitting it', () => {
    // Splitting here was the bug: "emma girik lina and the client is al
    // barsha motors" has four names divided by spaces and one client made of
    // three words, and no separator rule gets both right. Matching against
    // the real roster does — see match-parties.test.ts.
    expect(answerNames('priya')).toEqual(['priya'])
    expect(answerNames('priya and arjun')).toEqual(['priya and arjun'])
    expect(answerNames('with emma lina and the client is al barsha motors')).toEqual([
      'emma lina and the client is al barsha motors',
    ])
    expect(answerNames('  ')).toEqual([])
  })

  it('reads a pasted link and rejects anything else', () => {
    expect(answerUrl('https://zoom.us/j/123')).toBe('https://zoom.us/j/123')
    expect(answerUrl('here you go: https://meet.google.com/abc-defg-hij thanks')).toBe(
      'https://meet.google.com/abc-defg-hij',
    )
    expect(answerUrl('i dont have one')).toBeNull()
  })

  it('recognises a refusal to answer', () => {
    for (const no of ['no', 'nope', 'skip', 'never mind', 'forget it', 'cancel']) {
      expect(answerIsDecline(no)).toBe(true)
    }
    expect(answerIsDecline('3pm')).toBe(false)
    expect(answerIsDecline('zoom')).toBe(false)
  })
})
