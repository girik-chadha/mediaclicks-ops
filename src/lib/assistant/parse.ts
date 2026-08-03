import {
  parseDuration,
  parseRange,
  takeDay,
  takeTimeOfDay,
  type RangeSpec,
  type TimeExpr,
} from './when'

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

export type Intent =
  | { readonly kind: 'list'; readonly range: RangeSpec }
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
export const EXAMPLES: readonly string[] = [
  "What's on tomorrow?",
  'Find an hour next week for the team',
  'Move the Miniz review to Thursday at 3pm',
  'Cancel my next client call',
  'Swap Priya for Arjun on the Miniz review',
  'Tell Priya the review moved to Thursday',
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
  return input
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[?!,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim()
}

type Matcher = (text: string) => ParseResult | null

/* ── Matchers, most specific first ────────────────────────────────────── */

/** "swap priya for arjun on the miniz review" · "put arjun on x instead of priya" */
const reassign: Matcher = (text) => {
  const swap = /^(?:please\s+)?(?:swap|replace)\s+(.+?)\s+(?:for|with)\s+(.+?)\s+(?:on|in|for)\s+(.+)$/.exec(
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

  const instead = /^(?:please\s+)?(?:put|send|add)\s+(.+?)\s+(?:on|to)\s+(.+?)\s+instead\s+of\s+(.+)$/.exec(
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
  const m = /^(?:please\s+)?(?:tell|message|dm|ping|let)\s+([a-z][a-z'-]*)\s+(?:know\s+)?(.+)$/.exec(
    text,
  )
  if (!m) return null

  const message = m[2]!.trim()
  if (message.length < 2) {
    return { ok: false, reason: 'What should I say to them?' }
  }

  return ok({ kind: 'notify', toName: clean(m[1]!), message })
}

/** "cancel my next client call" · "cancel the miniz review because they rescheduled" */
const cancel: Matcher = (text) => {
  const m = /^(?:please\s+)?(?:cancel|call\s+off|drop|scrap)\s+(.+)$/.exec(text)
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
  const m = /^(?:please\s+)?(?:move|reschedule|shift|push|bump|change)\s+(.+?)\s+to\s+(.+)$/.exec(
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

/** "what's on tomorrow" · "show me this week" · "what have i got today" */
const list: Matcher = (text) => {
  const asks =
    /^(?:what(?:'s|s| is| are)?\b|what\s+(?:have|do)\s+i\b|show\b|list\b|any(?:thing)?\b)/.test(
      text,
    ) && /\b(?:on|got|have|meeting|meetings|schedule|calendar|today|tomorrow|week)\b/.test(text)

  if (!asks) return null

  // No range named ("what's on?") means the day in front of them.
  return ok({ kind: 'list', range: parseRange(text) ?? 'today' })
}

const MATCHERS: readonly Matcher[] = [reassign, notify, cancel, move, free, list]

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
