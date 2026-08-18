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

/** The server refuses anything longer (see meetingInput), so the grammar
 *  refuses it here too rather than staging a card that cannot be confirmed. */
export const MAX_DURATION_MINUTES = 12 * 60

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const WORD_ALT = Object.keys(WORDS).join('|')

const UNIT = 'h|hr|hrs|hours?|m|min|mins|minutes?'

/**
 * A count and its unit.
 *
 * Digits may be glued to the unit — "2h", "30m" — but a spelled-out number
 * must be separated from it. Without that rule "a" + "min" matches inside
 * the name Amin, and a meeting with him becomes a one-minute meeting with
 * nobody.
 */
const COUNTED = `(?:\\d{1,3}\\s*|(?:an?|${WORD_ALT})\\s+)`

/**
 * Every phrase parseDuration understands, as one expression.
 *
 * Exported because the schedule matcher has to *remove* the length it just
 * read, and a second regex written to match this one is a second regex that
 * can drift from it. When that happened the leftover words rode along into
 * whoever the meeting was with.
 */
export const DURATION_PHRASE = new RegExp(
  '\\b(?:for\\s+)?(?:' +
    // "1h30", "2h15m" — first, or the hour half matches alone and the
    // minutes are silently dropped.
    `\\d{1,2}\\s*(?:h|hr|hrs|hours?)\\s*\\d{1,2}\\s*(?:m|min|mins|minutes?)?` +
    // "half an hour" — the half leads, and divides rather than adds.
    `|half\\s+an?\\s+hour` +
    // "1.5 hours"
    `|\\d{1,2}[.,]\\d{1,2}\\s*(?:h|hr|hrs|hours?)` +
    // "two and a half hours", "an hour and a half" — English puts the half
    // on either side of the unit and neither order is the rare one.
    `|${COUNTED}(?:and\\s+a\\s+half\\s+)?(?:${UNIT})(?:\\s+and\\s+a\\s+half)?` +
    ')\\b',
  'i',
)

/**
 * "an hour", "30 minutes", "half an hour", "90 mins", "2h", "1.5 hours",
 * "an hour and a half", "two and a half hours", "1h30".
 */
export function parseDuration(text: string): number | null {
  const combined = /\b(\d{1,2})\s*(?:h|hr|hrs|hours?)\s*(\d{1,2})\s*(?:m|min|mins|minutes?)?\b/i.exec(
    text,
  )
  if (combined) return capped(Number(combined[1]) * 60 + Number(combined[2]))

  if (/\bhalf\s+an?\s+hour\b/i.test(text)) return 30

  // Decimal minutes are not a thing anybody says, so the fraction is only
  // honoured on hours.
  const fractional = /\b(\d{1,2})[.,](\d{1,2})\s*(?:h|hr|hrs|hours?)\b/i.exec(text)
  if (fractional) {
    return capped(Math.round((Number(fractional[1]) + Number(`0.${fractional[2]}`)) * 60))
  }

  const m = new RegExp(
    `\\b(?:(\\d{1,3})\\s*|(an?|${WORD_ALT})\\s+)(and\\s+a\\s+half\\s+)?(${UNIT})\\b(\\s+and\\s+a\\s+half)?`,
    'i',
  ).exec(text)
  if (!m) return null

  const n = countOf(m[1] ?? m[2])
  if (n === null) return null

  const isHours = m[4]!.toLowerCase().startsWith('h')
  const half = m[3] || m[5] ? (isHours ? 30 : 0) : 0
  return capped((isHours ? n * 60 : n) + half)
}

function countOf(token: string | undefined): number | null {
  if (!token) return null
  const key = token.toLowerCase()
  if (/^an?$/.test(key)) return 1
  if (WORDS[key] !== undefined) return WORDS[key]!
  const n = Number(key)
  return Number.isFinite(n) ? n : null
}

const capped = (minutes: number): number | null =>
  minutes > 0 && minutes <= MAX_DURATION_MINUTES ? minutes : null

export interface TimeRange {
  readonly start: TimeOfDay
  readonly end: TimeOfDay
  readonly durationMinutes: number
}

/**
 * Pulls a *span* out of the text: "6pm to 7pm", "3-4:30", "from 9 until 11",
 * "between 2 and 3pm", "18:00-19:00".
 *
 * This is the half of "when" the grammar was missing. Naming both ends is
 * the most natural way to book something that is not the default length —
 * "tomorrow 6pm to 7pm" — and without it every such request was heard as a
 * start time with the duration silently falling back to thirty minutes. A
 * meeting an hour shorter than the one you asked for is exactly the kind of
 * confident wrongness ADR 0007 warns about: the card looks right.
 */
export function takeTimeRange(text: string): { range: TimeRange; rest: string } | null {
  // "and" is only a separator after "between", because "with priya and
  // arjun" is not a time range and requiring digits on both sides is not
  // enough on its own to make that safe.
  const dashed =
    /\b(?:from\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|till|til|until|through)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i.exec(
      text,
    )
  const between =
    /\bbetween\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s+and\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i.exec(
      text,
    )

  const m = between ?? dashed
  if (!m) return null

  const startRaw = Number(m[1])
  const startMin = Number(m[2] ?? 0)
  const startMer = m[3]?.toLowerCase()
  const endRaw = Number(m[4])
  const endMin = Number(m[5] ?? 0)
  const endMer = m[6]?.toLowerCase()

  if (!plausible(startRaw, startMin) || !plausible(endRaw, endMin)) return null

  const picked = pickRange(
    { raw: startRaw, minute: startMin, meridiem: startMer },
    { raw: endRaw, minute: endMin, meridiem: endMer },
  )
  if (!picked) return null

  return { range: picked, rest: cut(text, m) }
}

const plausible = (hour: number, minute: number) =>
  hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59

interface Spoken {
  readonly raw: number
  readonly minute: number
  readonly meridiem: string | undefined
}

/**
 * Every 24-hour reading a spoken hour could have.
 *
 * "7pm" has one. A bare "7" has two, and which one is meant depends on the
 * *other* end of the range — "7 to 8" is the evening, "11 to 1" straddles
 * noon — so the choice cannot be made one end at a time.
 */
function candidates(s: Spoken): number[] {
  const at = (hour: number) => hour * 60 + s.minute

  if (s.meridiem === 'pm') return [at(s.raw < 12 ? s.raw + 12 : s.raw)]
  if (s.meridiem === 'am') return [at(s.raw === 12 ? 0 : s.raw)]
  if (s.raw > 12) return [at(s.raw)]
  if (s.raw === 12) return [at(12), at(0)]
  return [at(s.raw), at(s.raw + 12)]
}

/** 06:00–22:00. Outside it, a range is more likely misread than nocturnal. */
const DAYTIME_FROM = 6 * 60
const DAYTIME_TO = 22 * 60

/**
 * Picks the reading of an ambiguous range that a person would have meant.
 *
 * Scored rather than rule-chained, because the rules interact: "11 to 1"
 * only works if the two ends are allowed to take different halves of the
 * day, and "6 to 7" only lands in the evening if the same bare-hour
 * convention takeTimeOfDay uses is applied here too.
 */
function pickRange(start: Spoken, end: Spoken): TimeRange | null {
  let best: { range: TimeRange; score: number } | null = null

  for (const s of candidates(start)) {
    for (const e of candidates(end)) {
      const duration = e - s
      if (duration <= 0 || duration > MAX_DURATION_MINUTES) continue

      let score = duration / (24 * 60) // tie-break: the shorter reading wins
      if (s < DAYTIME_FROM || s > DAYTIME_TO) score += 100
      if (e < DAYTIME_FROM || e > DAYTIME_TO) score += 100
      // The same convention takeTimeOfDay applies to a bare hour: 1–7 means
      // the afternoon, because a working day does not start at three in the
      // morning. Kept in step deliberately — two different answers to "does
      // 6 mean 06:00" would be worse than either answer.
      if (!start.meridiem && start.raw >= 1 && start.raw <= 7 && s < 12 * 60) score += 10

      if (!best || score < best.score) {
        best = {
          score,
          range: {
            start: { hour: Math.floor(s / 60), minute: s % 60 },
            end: { hour: Math.floor(e / 60), minute: e % 60 },
            durationMinutes: duration,
          },
        }
      }
    }
  }

  return best?.range ?? null
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
