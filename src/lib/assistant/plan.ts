import type { ToolName } from './tools'

/**
 * What the assistant proposes, and what the "Will do" card renders.
 *
 * §4.6: "Any destructive or externally-visible action renders a confirmation
 * card the user must approve." A staged action is that proposal — the tool
 * call the model asked for, resolved and permission-checked, but not run.
 */
export interface StagedAction {
  readonly tool: ToolName
  /** Validated against the tool's schema before it got here. */
  readonly input: Readonly<Record<string, string>>
  /** Mono column in the card: "Move", "Cancel", "Message". */
  readonly verb: string
  /** The sentence beside it, in the user's own timezone. */
  readonly what: string
}

/**
 * What the planner returns: a sentence for above the card, and the actions
 * for inside it. This is the seam — anything that can turn a request into
 * these two things plugs in without the confirmation machinery noticing.
 */
export interface AssistantReply {
  readonly answer: string
  readonly actions: readonly StagedAction[]
  /**
   * Set when the assistant asked a question it needs an answer to.
   *
   * A request can be half-specified — "schedule a gmeet with Priya" names
   * no time and carries no link — and the only honest responses are to
   * refuse or to ask. Refusing makes the person retype the whole sentence
   * with the missing bit wedged in. Asking requires remembering what they
   * already said, which is what this carries.
   *
   * Sealed on the way out and back, like a plan, so the conversation cannot
   * be rewritten in the browser between turns.
   */
  readonly pending?: PendingSchedule
}

/** A schedule request that is missing something, plus what was asked for. */
export interface PendingSchedule {
  readonly kind: 'schedule'
  readonly withNames: readonly string[]
  readonly dayIso: string | null
  readonly hour: number | null
  readonly minute: number | null
  readonly durationMinutes: number
  readonly provider: 'google_meet' | 'zoom' | 'whatsapp' | 'none' | null
  readonly title: string
  readonly url: string
  /** Routes a bare reply — "3pm" is a time only because we asked for one. */
  readonly awaiting: 'people' | 'time' | 'provider' | 'link'
}

/** What the user gets back after confirming: the same shape, past tense. */
export interface PerformedAction {
  readonly verb: string
  readonly what: string
  readonly ok: boolean
}
