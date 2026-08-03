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
}

/** What the user gets back after confirming: the same shape, past tense. */
export interface PerformedAction {
  readonly verb: string
  readonly what: string
  readonly ok: boolean
}
