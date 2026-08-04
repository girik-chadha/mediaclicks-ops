import { addDays, fromWallClock, startOfDay, startOfWeek, toWallClock, zoneOffsetMs } from '@/lib/time'

/**
 * Time expressions, and how they resolve.
 *
 * Split from the grammar in parse.ts because "what did they say" and "what
 * instant is that" are different questions, and only the second one needs a
 * timezone. Both halves are pure, so every rule below — including the
 * awkward ones about which Thursday someone means — is a test rather than a
 * thing you find out in production.
 */

export type DaySpec =
  | { readonly kind: 'today' }
  | { readonly kind: 'tomorrow' }
  /** An already-resolved day, carried across turns of a conversation. */
  | { readonly kind: 'onDate'; readonly iso: string }
  /** 0 = Sunday, matching getUTCDay. `next` skips to the following week. */
  | { readonly kind: 'weekday'; readonly weekday: number; readonly next: boolean }

export interface TimeOfDay {
  readonly hour: number
  readonly minute: number
}

export interface TimeExpr {
  /** Null keeps the day the meeting is already on — "move it to 4pm". */
  readonly day: DaySpec | null
  /** Null keeps the time it already starts at — "move it to Thursday". */
  readonly time: TimeOfDay | null
}

export type RangeSpec = 'today' | 'tomorrow' | 'this-week' | 'next-week'

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  weds: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
}

/**
 * Vague parts of the day. Named here rather than left to the caller so
 * "afternoon" means the same thing everywhere, and so it is one line to
 * change when someone decides it should mean 14:00.
 */
const PARTS: Record<string, TimeOfDay> = {
  morning: { hour: 10, minute: 0 },
  afternoon: { hour: 15, minute: 0 },
  evening: { hour: 17, minute: 0 },
  lunchtime: { hour: 13, minute: 0 },
}

/* ── Parsing ──────────────────────────────────────────────────────────── */

/** Pulls a day out of the text, returning it and whatever is left. */
export function takeDay(text: string): { day: DaySpec; rest: string } | null {
  const tomorrow = /\btomorrow\b/.exec(text)
  if (tomorrow) return { day: { kind: 'tomorrow' }, rest: cut(text, tomorrow) }

  const today = /\b(?:today|this\s+afternoon|this\s+morning|this\s+evening)\b/.exec(text)
  // "this afternoon" is a day *and* a time; the time half is found separately
  // by takeTimeOfDay, which is why the match is not consumed here.
  if (today) {
    return {
      day: { kind: 'today' },
      rest: today[0] === 'today' ? cut(text, today) : text,
    }
  }

  const weekday = /\b(next\s+)?(sun|mon|tues?|weds?|thur?s?|fri|sat)(?:day|nesday|rsday|urday)?\b/.exec(
    text,
  )
  if (weekday) {
    const key = weekday[2]!
    const day = WEEKDAYS[key] ?? WEEKDAYS[key + 'day']
    if (day !== undefined) {
      return {
        day: { kind: 'weekday', weekday: day, next: Boolean(weekday[1]) },
        rest: cut(text, weekday),
      }
    }
  }

  return null
}

/**
 * Pulls a clock time or a part of the day out of the text.
 *
 * `bareNumberIsTime` is set by callers who already know the whole phrase is
 * a time — everything after "move it **to** …". Without it a bare number is
 * not read as a clock time, because "find 30 minutes next week" would
 * otherwise schedule things for half past midnight.
 */
export function takeTimeOfDay(
  text: string,
  bareNumberIsTime = false,
): { time: TimeOfDay; rest: string } | null {
  // 3pm · 3:30pm · 15:00 · at 9 · 9.30am
  const clock = /\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i.exec(text)
  if (clock) {
    const raw = Number(clock[1])
    const minute = Number(clock[2] ?? 0)
    const meridiem = clock[3]?.toLowerCase()

    const introduced =
      bareNumberIsTime ||
      /\bat\s+$/.test(text.slice(0, clock.index)) ||
      clock[0].startsWith('at')
    const plausible = raw >= 0 && raw <= 23 && minute >= 0 && minute <= 59

    if (plausible && (meridiem || introduced)) {
      let hour = raw
      if (meridiem === 'pm' && hour < 12) hour += 12
      if (meridiem === 'am' && hour === 12) hour = 0
      // "move it to 3" in a working day means the afternoon, not 03:00.
      // Only for a bare hour: "09:45" is already unambiguous, and nudging
      // it would turn a stated time into a different one.
      if (!meridiem && clock[2] === undefined && hour >= 1 && hour <= 7) hour += 12
      return { time: { hour, minute }, rest: cut(text, clock) }
    }
  }

  const part = /\b(morning|afternoon|evening|lunchtime)\b/.exec(text)
  if (part) {
    return { time: PARTS[part[1]!]!, rest: cut(text, part) }
  }

  return null
}

/** "an hour", "30 minutes", "half an hour", "90 mins", "2h". */
export function parseDuration(text: string): number | null {
  if (/\bhalf\s+an?\s+hour\b/.test(text)) return 30
  if (/\ban?\s+hour\b/.test(text)) return 60

  const explicit = /\b(\d{1,3})\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/.exec(text)
  if (explicit) {
    const n = Number(explicit[1])
    const unit = explicit[2]!
    const minutes = unit.startsWith('h') ? n * 60 : n
    return minutes > 0 && minutes <= 12 * 60 ? minutes : null
  }

  return null
}

export function parseRange(text: string): RangeSpec | null {
  return parseRanges(text)[0] ?? null
}

/**
 * Every range named in the sentence, not just the first.
 *
 * "the meetings today and tomorrow" names two, and answering only the first
 * drops half of what was asked for — the kind of wrong that looks like a
 * right answer. The caller unions them.
 */
export function parseRanges(text: string): RangeSpec[] {
  const found: RangeSpec[] = []
  const add = (r: RangeSpec) => {
    if (!found.includes(r)) found.push(r)
  }

  if (/\bnext\s+week\b/.test(text)) add('next-week')
  if (/\bthis\s+week\b|\bthe\s+week\b|\brest\s+of\s+the\s+week\b/.test(text)) add('this-week')
  if (/\btomorrow\b/.test(text)) add('tomorrow')
  if (/\btoday\b|\bthis\s+(?:morning|afternoon|evening)\b/.test(text)) add('today')

  // Chronological, so a union spans the right window regardless of the order
  // the person happened to say them in.
  const ORDER: RangeSpec[] = ['today', 'tomorrow', 'this-week', 'next-week']
  return found.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
}

const cut = (text: string, m: RegExpExecArray) =>
  (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()

/* ── Resolving ────────────────────────────────────────────────────────── */

/** Local midnight of the day the expression names. */
export function resolveDay(day: DaySpec, now: Date, zone: string): Date {
  const todayStart = startOfDay(now, zone)

  switch (day.kind) {
    case 'onDate':
      // Resolved on an earlier turn. Replayed rather than re-derived, so
      // "tomorrow" said at 23:59 still means the day it meant when it was
      // heard, not the day the answer happened to arrive on.
      return startOfDay(new Date(day.iso), zone)
    case 'today':
      return todayStart
    case 'tomorrow':
      return addDays(todayStart, 1, zone)
    case 'weekday': {
      const current = localWeekday(todayStart, zone)
      // Strictly ahead: "Thursday" said on a Thursday means the next one,
      // because the request is almost always about a day that has not
      // happened yet. Time-of-day cannot rescue it — resolveWhen checks.
      let ahead = (day.weekday - current + 7) % 7
      if (ahead === 0) ahead = 7

      const target = addDays(todayStart, ahead, zone)
      if (!day.next) return target

      // "next Thursday" means the Thursday of next week. If the plain
      // occurrence is still inside this week, push it a week on. English is
      // genuinely ambiguous here; this is the reading, and it is tested.
      const nextWeek = addDays(startOfWeek(now, zone), 7, zone)
      return target.getTime() < nextWeek.getTime() ? addDays(target, 7, zone) : target
    }
  }
}

export function resolveRange(
  range: RangeSpec,
  now: Date,
  zone: string,
): { from: Date; to: Date } {
  const todayStart = startOfDay(now, zone)

  switch (range) {
    case 'today':
      return { from: todayStart, to: addDays(todayStart, 1, zone) }
    case 'tomorrow': {
      const from = addDays(todayStart, 1, zone)
      return { from, to: addDays(from, 1, zone) }
    }
    case 'this-week': {
      const from = startOfWeek(now, zone)
      return { from, to: addDays(from, 7, zone) }
    }
    case 'next-week': {
      const from = addDays(startOfWeek(now, zone), 7, zone)
      return { from, to: addDays(from, 7, zone) }
    }
  }
}

/** Puts a clock time onto a day, in that day's zone. */
export function atTime(dayStart: Date, time: TimeOfDay, zone: string): Date {
  const { year, month, day } = toWallClock(dayStart, zone)
  return fromWallClock({ year, month, day, hour: time.hour, minute: time.minute }, zone)
}

/**
 * Resolves a whole expression against the meeting being moved.
 *
 * Either half may be absent: "move it to Thursday" keeps the time,
 * "move it to 4pm" keeps the day. Both absent is not a move, and the
 * grammar never produces it.
 */
export function resolveWhen(
  when: TimeExpr,
  current: Date,
  now: Date,
  zone: string,
): Date {
  const dayStart = when.day ? resolveDay(when.day, now, zone) : startOfDay(current, zone)
  const time = when.time ?? toWallClock(current, zone)
  return atTime(dayStart, { hour: time.hour, minute: time.minute }, zone)
}

function localWeekday(instant: Date, zone: string): number {
  return new Date(instant.getTime() + zoneOffsetMs(instant, zone)).getUTCDay()
}
