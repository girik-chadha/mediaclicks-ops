import {
  parseDuration,
  parseRange,
  parseRanges,
  takeDay,
  takeTimeOfDay,
  type RangeSpec,
  type TimeExpr,
} from './when'

/**
 * Normalisation strips most punctuation but keeps `:` and `/` so that
 * "3:30pm" and a pasted URL survive to their own matchers.
 */

/**
 * The grammar (§4.6, without a model).
 *
 * Turns a sentence into an intent, or into an honest refusal. Pure: no
 * database, no clock, no timezone — it says *what was asked*, not what that
 * resolves to, which is what lets every rule here be a test.
 *
 * The deal this makes with the user is narrow competence over broad
 * pretence. It understands a listed set of phrasings exactly, and when it
 * does not understand it says so and shows the set, rather than guessing at
 * a meeting and staging a cancellation against it.
 */

export type MeetingRef =
  /** "my next meeting", "my next client call" */
  | { readonly kind: 'next'; readonly clientOnly: boolean }
  /** A substring of the title — resolved against real meetings later. */
  | { readonly kind: 'title'; readonly text: string }

/** As written in the sentence. Resolved against clients and team later. */
export interface ScheduleIntent {
  readonly kind: 'schedule'
  /** Names after "with" — could be a client, could be teammates, could be both. */
  readonly withNames: readonly string[]
  readonly when: TimeExpr
  readonly durationMinutes: number
  /** Null when nothing was said; the planner asks rather than assuming. */
  readonly provider: 'google_meet' | 'zoom' | 'whatsapp' | 'none' | null
  /** From "about X" / "called X". Empty means derive one from who is on it. */
  readonly title: string
  /** A pasted join link, if the sentence carried one. */
  readonly url: string
}

export type Intent =
  | { readonly kind: 'list'; readonly ranges: readonly RangeSpec[] }
  | ScheduleIntent
  | {
      readonly kind: 'free'
      readonly durationMinutes: number
      readonly range: RangeSpec | null
      readonly withWholeTeam: boolean
    }
  | { readonly kind: 'move'; readonly ref: MeetingRef; readonly when: TimeExpr }
  | { readonly kind: 'cancel'; readonly ref: MeetingRef; readonly reason: string }
  | {
      readonly kind: 'reassign'
      readonly ref: MeetingRef
      readonly fromName: string
      readonly toName: string
    }
  | { readonly kind: 'notify'; readonly toName: string; readonly message: string }

export type ParseResult =
  | { readonly ok: true; readonly intent: Intent }
  | { readonly ok: false; readonly reason: string }

/** Shown whenever the grammar does not match. Kept beside it so it cannot
 *  advertise something the parser stopped understanding. */
/**
 * Written generically on purpose. These are the panel's suggestion buttons
 * and its list of what it can do, so naming a real client here taught the
 * reader that the assistant only works on that client — and made the panel
 * look broken the moment they typed a different name.
 */
export const EXAMPLES: readonly string[] = [
  'Schedule a call with <name> tomorrow at 3pm',
  "What's on this week?",
  'Find an hour next week for the team',
  'Move <meeting> to Thursday at 3pm',
  'Cancel my next client call',
  'Swap <name> for <name> on <meeting>',
  'Tell <name> the review moved to Thursday',
]

/** The three offered as clickable buttons — real sentences, not templates. */
export const STARTERS: readonly string[] = [
  "What's on this week?",
  'Find an hour next week for the team',
  'Schedule a call tomorrow at 3pm',
]

const NO_MATCH: ParseResult = {
  ok: false,
  reason: "I didn't follow that. I understand a fixed set of requests — try one of the examples.",
}

export function parse(input: string): ParseResult {
  const text = normalise(input)
  if (!text) return { ok: false, reason: 'Say what you need.' }

  for (const matcher of MATCHERS) {
    const result = matcher(text)
    if (result) return result
  }

  return NO_MATCH
}

/**
 * Lowercased, punctuation-stripped, whitespace-collapsed. Curly quotes and
 * apostrophes are folded to ASCII first: a phone keyboard produces "don't"
 * with U+2019, and a grammar that only knows U+0027 would reject half the
 * real input for a reason nobody could see.
 */
function normalise(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[?!,;]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\.$/, '')
      .trim()
      // Politeness, stripped once here rather than in seven matchers. People
      // ask for things the way they ask people for things — "can u schedule
      // …" is the normal case, not the exotic one, and every matcher anchors
      // to the start of the string.
      .replace(
        new RegExp(
          '^(?:hey |hi |ok(?:ay)? |so )?' +
            '(?:' +
            // "can you", "could u", "would we"
            '(?:can|could|would|will)\\s+(?:you|u|we|i)\\s+(?:please\\s+)?' +
            // "i'd like to", "i want to", "i need to" — note i'd has no
            // space after the i, which an `i\s+` alternation misses.
            "|i(?:'?d\\s+like|\\s+(?:want|need|would\\s+like))\\s+(?:you\\s+)?to\\s+" +
            '|please\\s+|pls\\s+|let\'?s\\s+' +
            ')',
        ),
        '',
      )
      .trim()
  )
}

type Matcher = (text: string) => ParseResult | null

/* ── Matchers, most specific first ────────────────────────────────────── */

/** "swap priya for arjun on the miniz review" · "put arjun on x instead of priya" */
const reassign: Matcher = (text) => {
  const swap = /\b(?:swap|replace)\s+(.+?)\s+(?:for|with)\s+(.+?)\s+(?:on|in|for)\s+(.+)$/.exec(
    text,
  )
  if (swap) {
    const ref = reference(swap[3]!)
    if (!ref) return { ok: false, reason: 'Which meeting?' }
    return ok({
      kind: 'reassign',
      fromName: clean(swap[1]!),
      toName: clean(swap[2]!),
      ref,
    })
  }

  const instead = /\b(?:put|send|add)\s+(.+?)\s+(?:on|to)\s+(.+?)\s+instead\s+of\s+(.+)$/.exec(
    text,
  )
  if (instead) {
    const ref = reference(instead[2]!)
    if (!ref) return { ok: false, reason: 'Which meeting?' }
    return ok({
      kind: 'reassign',
      toName: clean(instead[1]!),
      fromName: clean(instead[3]!),
      ref,
    })
  }

  return null
}

/** "tell priya the review moved" · "message arjun about friday" */
const notify: Matcher = (text) => {
  const m = /\b(?:tell|message|dm|ping|let)\s+([a-z][a-z'-]*)\s+(?:know\s+)?(.+)$/.exec(
    text,
  )
  if (!m) return null

  // "tell me what's on tomorrow" is a question, not a message to a colleague
  // called Me. Rejected here rather than in the executor so it falls through
  // to the matchers below instead of dying as a self-DM.
  if (/^(?:me|us|myself|everyone|everybody)$/.test(m[1]!)) return null

  const message = m[2]!.trim()
  if (message.length < 2) {
    return { ok: false, reason: 'What should I say to them?' }
  }

  return ok({ kind: 'notify', toName: clean(m[1]!), message })
}

/** "cancel my next client call" · "cancel the miniz review because they rescheduled" */
const cancel: Matcher = (text) => {
  const m = /\b(?:cancel|call\s+off|drop|scrap)\s+(.+)$/.exec(text)
  if (!m) return null

  let rest = m[1]!
  let reason = ''

  const because = /\s+(?:because|as|since)\s+(.+)$/.exec(rest)
  if (because) {
    reason = because[1]!.trim()
    rest = rest.slice(0, because.index)
  }

  const ref = reference(rest)
  if (!ref) return { ok: false, reason: 'Which meeting should I cancel?' }

  return ok({ kind: 'cancel', ref, reason })
}

/** "move the miniz review to thursday at 3pm" · "push my next meeting to 4" */
const move: Matcher = (text) => {
  const m = /\b(?:move|reschedule|shift|push|bump|change)\s+(.+?)\s+to\s+(.+)$/.exec(
    text,
  )
  if (!m) return null

  const ref = reference(m[1]!)
  if (!ref) return { ok: false, reason: 'Which meeting should I move?' }

  const when = timeExpression(m[2]!)
  if (!when) {
    return {
      ok: false,
      reason: "I didn't catch the new time. Try \"Thursday at 3pm\", \"tomorrow morning\", or \"4pm\".",
    }
  }

  return ok({ kind: 'move', ref, when })
}

/** "find an hour next week for the team" · "when is everyone free for 30 minutes" */
const free: Matcher = (text) => {
  const duration = parseDuration(text)

  // Either they said a word about availability, or they asked to *find* a
  // specific length of time. "Book a meeting with the client on Tuesday" is
  // neither — it is a creation request, which this does not do, and reading
  // it as a slot search would answer a question nobody asked.
  const looksLikeIt =
    /\b(?:free|available|availability|open\s+slot|a\s+slot|some\s+time|find\s+time)\b/.test(text) ||
    (/^find\s+/.test(text) && duration !== null)
  if (!looksLikeIt) return null

  const durationMinutes = duration ?? 60
  const withWholeTeam = /\b(?:everyone|the\s+team|all\s+of\s+us|whole\s+team|us\s+all)\b/.test(text)

  return ok({ kind: 'free', durationMinutes, range: parseRange(text), withWholeTeam })
}

/**
 * "what's on tomorrow" · "give me a rundown of the meetings today and
 * tomorrow" · "whats my week looking like"
 *
 * The last matcher, and the loosest, because it is the only one with no side
 * effect: reading the schedule back is safe to be wrong about in a way that
 * cancelling a meeting is not. It looks for two signals anywhere in the
 * sentence rather than a keyword at position zero — anchoring meant "what's
 * on today" worked and "give me a rundown of today" did not, which is not a
 * distinction anybody asking would recognise.
 */
const list: Matcher = (text) => {
  // Questions that are about the calendar but are not requests to see it.
  // "Who is busiest this week" mentions a week and means something the
  // assistant cannot work out; answering with a list of meetings would be
  // answering a different question and looking confident about it.
  if (/^(?:who|why|how\s+(?:many|much|long|often)|which\s+(?:person|one))\b/.test(text)) {
    return null
  }

  const asking =
    /\b(?:what|whats|show|list|give|see|check|know|find\s+out|tell\s+me|remind\s+me|any|anything|got|have|has|rundown|overview|summary|agenda|diary|looking\s+like|look\s+like|coming\s+up|lined\s+up)\b/.test(
      text,
    )

  const aboutSchedule =
    /\b(?:meeting|meetings|schedule|calendar|rundown|agenda|diary|booked|day|week|on)\b/.test(text)

  const ranges = parseRanges(text)

  // A noun and a window together are a request even with no question word —
  // "meetings today and tomorrow" is a perfectly clear thing to type. With
  // only one of the two, something has to be doing the asking.
  const named = aboutSchedule && ranges.length > 0
  if (!named && !asking) return null
  if (!named && !aboutSchedule && ranges.length === 0) return null

  // No range named ("what's on?") means the day in front of them.
  return ok({ kind: 'list', ranges: ranges.length > 0 ? ranges : ['today'] })
}

/**
 * "schedule a whatsapp call with miniz tomorrow at 3pm"
 * "book 30 minutes with priya and arjun on friday about the campaign"
 *
 * Parsed subtractively rather than with one expression: each slot is taken
 * out of the sentence and the remainder carries on to the next. A single
 * regex would have to anticipate every ordering, and real sentences put the
 * platform in the middle ("with miniz it will be a whatsapp call") as
 * happily as at the end.
 */
const schedule: Matcher = (text) => {
  // "schedule" and "book" are also nouns, and "tell me my schedule for
  // tomorrow" is a question about the calendar, not an instruction to fill
  // it. A determiner in front makes it a noun; nothing else distinguishes
  // the two, so that is what the lookbehind checks.
  const opener =
    /(?<!\b(?:my|your|our|their|his|her|the|a|this)\s)\b(?:schedule|book|set\s+up|arrange|organise|organize)\s+(?:a|an|the)?\s*(?:new\s+)?(?:meeting|call|sync|catch\s*up|session|slot)?\s*/.exec(
      text,
    ) ?? /\bnew\s+meeting\s*/.exec(text)
  if (!opener) return null

  let rest = text.slice(opener.index + opener[0].length).trim()

  // 1. A pasted link, before punctuation-stripping can maul it.
  let url = ''
  const link = /\bhttps?:\/\/\S+/.exec(rest)
  if (link) {
    url = link[0]
    rest = strip(rest, link)
  }

  // 2. Platform. Taken early because "whatsapp call" would otherwise be
  //    read as part of whoever the meeting is with.
  let provider: ScheduleIntent['provider'] = null
  const platform =
    /\b(whats\s?app|google\s*meet|meet|zoom|no\s+platform|no\s+link|in\s+person|phone)\b/.exec(rest)
  if (platform) {
    provider = PROVIDERS[platform[1]!.replace(/\s+/g, ' ')] ?? null
    if (provider) rest = strip(rest, platform)
  }

  // 3. Filler the platform clause leaves behind: "it will be a", "on".
  rest = rest
    .replace(/\b(?:it\s+(?:will|'?ll)\s+be|its|it's|this\s+is|that\s+is)\s+(?:a|an|on)?\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 4. Title, if named outright. Deliberately not "for": "schedule a call
  //    for tomorrow at 3pm" would title the meeting "tomorrow at 3pm".
  let title = ''
  const about = /\b(?:about|called|titled|regarding)\s+(.+)$/.exec(rest)
  if (about) {
    title = clean(about[1]!)
    rest = rest.slice(0, about.index).trim()
  }

  // 5. Duration, before the time — "30 minutes" must not become 00:30.
  const durationMinutes = parseDuration(rest) ?? 30
  const dur = /\b(?:for\s+)?(?:half\s+an?\s+hour|an?\s+hour|\d{1,3}\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes))\b/.exec(
    rest,
  )
  if (dur) rest = strip(rest, dur)

  // 6. When.
  const day = takeDay(rest)
  if (day) rest = day.rest
  const time = takeTimeOfDay(rest)
  if (time) rest = time.rest

  // A missing time is no longer a refusal. "Schedule a gmeet with Priya"
  // is a perfectly clear request with a gap in it, and the planner asks
  // rather than making the person retype the sentence.

  // 7. Whatever "with" introduced is who it is with.
  const withNames: string[] = []
  const withClause = /\bwith\s+(.+)$/.exec(rest)
  if (withClause) {
    for (const part of withClause[1]!.split(/\s+and\s+|,/)) {
      const name = denoise(part)
      if (name.length >= 2) withNames.push(name)
    }
  }

  return ok({
    kind: 'schedule',
    withNames,
    when: { day: day?.day ?? null, time: time?.time ?? null },
    durationMinutes,
    provider,
    title,
    url,
  })
}

/* ── Answering a question the assistant asked ─────────────────────────────
   A bare reply carries no verb: "3pm", "priya and arjun", "zoom", a pasted
   URL. It only means anything in the light of what was asked, so these are
   parsed against the expected slot rather than through the matchers above.
   That is also what stops "zoom" being read as a request to schedule one. */

export function answerTime(text: string): TimeExpr | null {
  const cleaned = normalise(text)
  const day = takeDay(cleaned)
  const rest = day ? day.rest : cleaned
  const time = takeTimeOfDay(rest, true)
  if (!day && !time) return null
  return { day: day?.day ?? null, time: time?.time ?? null }
}

export function answerProvider(text: string): ScheduleIntent['provider'] | null {
  const m = /\b(whats\s?app|google\s*meet|meet|zoom|no\s+platform|no\s+link|in\s+person|phone|none)\b/.exec(
    normalise(text),
  )
  if (!m) return null
  const key = m[1]!.replace(/\s+/g, ' ')
  return key === 'none' ? 'none' : (PROVIDERS[key] ?? null)
}

export function answerNames(text: string): string[] {
  const cleaned = normalise(text).replace(/^\s*with\s+/, '')
  return cleaned
    .split(/\s+and\s+|,/)
    .map(denoise)
    .filter((n) => n.length >= 2)
}

export function answerUrl(text: string): string | null {
  return /\bhttps?:\/\/\S+/.exec(text)?.[0] ?? null
}

/** "no", "skip", "none", "never mind" — a refusal to answer, not an answer. */
export function answerIsDecline(text: string): boolean {
  return /^(?:no|nope|none|skip|nvm|never\s*mind|cancel|forget\s+it|stop)\b/.test(normalise(text))
}

const PROVIDERS: Record<string, ScheduleIntent['provider']> = {
  whatsapp: 'whatsapp',
  'whats app': 'whatsapp',
  zoom: 'zoom',
  meet: 'google_meet',
  'google meet': 'google_meet',
  'no platform': 'none',
  'no link': 'none',
  'in person': 'none',
  phone: 'none',
}

const strip = (text: string, m: RegExpExecArray) =>
  (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()

const MATCHERS: readonly Matcher[] = [schedule, reassign, notify, cancel, move, free, list]

/* ── Shared pieces ────────────────────────────────────────────────────── */

const ok = (intent: Intent): ParseResult => ({ ok: true, intent })

/**
 * "my next client call" · "the miniz review" · "miniz"
 *
 * Returns a *reference*, not a meeting. Resolving it needs real rows, and
 * doing that here would drag a database into the one module that is worth
 * keeping free of one.
 */
function reference(raw: string): MeetingRef | null {
  const text = clean(raw)
  if (!text) return null

  if (/\bnext\b/.test(text) || /^(?:it|that|this)$/.test(text)) {
    return {
      kind: 'next',
      clientOnly: /\bclient\b/.test(text),
    }
  }

  // Strip the words that describe rather than name, so "the miniz review
  // meeting" matches a meeting titled "Miniz review".
  const title = text
    .replace(/\b(?:the|my|our|a|an)\b/g, ' ')
    .replace(/\b(?:meeting|call|sync|catch\s*up|session)$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return title.length >= 2 ? { kind: 'title', text: title } : null
}

function timeExpression(raw: string): TimeExpr | null {
  let rest = clean(raw)

  const day = takeDay(rest)
  if (day) rest = day.rest

  // Everything after "to" is a time expression by construction, so a bare
  // number here means a clock time — "move it to 3".
  const time = takeTimeOfDay(rest, true)

  if (!day && !time) return null
  return { day: day?.day ?? null, time: time?.time ?? null }
}

const clean = (text: string) =>
  text
    .replace(/^\s*(?:the|my|our|please)\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Strips the words that describe a meeting from the words that name a
 * person or a client.
 *
 * Taking slots out of the sentence one at a time leaves debris: removing
 * "whatsapp" from "with miniz it will be a whatsapp call" leaves "call",
 * and removing "friday" from "with arjun on friday" leaves "on". Both then
 * ride along into a name and stop it matching anything. Whole words only,
 * and the resolver matches on substrings, so a client genuinely called
 * "On Point Media" still resolves from "point media".
 */
const NAME_NOISE =
  /\b(?:the|a|an|team|call|meeting|sync|session|chat|catch\s*up|on|at|in|for|to|with|and|next|this|guys|folks)\b/g

const denoise = (text: string) =>
  clean(text).replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim()
