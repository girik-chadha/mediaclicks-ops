# ADR 0007 — The assistant proposes; a person disposes

**Status:** accepted
**Date:** 2026-08-03

## Context

§4.6 asks for a tool-calling assistant that can reschedule, cancel, reassign
and notify. Three of those four are irreversible from the point of view of the
people affected: a cancellation email cannot be recalled, and a message in
someone's chat has been read by the time you regret it.

The spec sets two hard constraints:

- every tool call goes through the same permission layer as the UI, so the
  agent cannot exceed the human;
- any destructive or externally-visible action renders a confirmation card the
  human must approve.

The obvious implementation satisfies the letter of both and the spirit of
neither: run the tools, then show the person what happened and offer an undo.
That is a progress notice wearing a confirmation dialog's clothes.

## Decision

**Tools that change something do not change anything.**

The toolset splits by declared `effect`:

- `read` tools (`list_team`, `list_my_meetings`, `find_free_slot`) execute
  immediately. They are queries; the person could run them by looking.
- `write` tools (`reschedule_meeting`, `cancel_meeting`, `reassign_meeting`,
  `notify_user`) resolve their arguments, check permission, and return a
  *description* of what would happen. Their tool result begins "Staged, not
  yet done".

The model has no way to reach a write. There is no tool it can call, no
argument it can pass, and no sequence of calls that ends in a database write.
The only code path to an effect is `performPlan()`, and the only caller of
that is the Confirm button.

**Authorization is checked twice, for two different reasons.**

At planning time, `requirePermission()` runs so the model gets a usable
refusal — "Emma can't edit other people's meetings" — and can say so instead
of staging something that will fail. At execution time it runs again, inside
the same `updateMeeting` / `cancelMeeting` the forms call, and *that* is the
gate. A permission revoked while someone reads the card takes effect.

**The plan is signed.**

The staged plan makes a round trip through the browser. It is HMAC'd with
`AUTH_SECRET`, bound to the actor's id, and expires in fifteen minutes.

This is not what stops privilege escalation — re-checking permission on
execution does that, and a forged plan still cannot exceed what the person
could do by clicking. The signature buys the property the button claims:
that the thing being confirmed is the thing that was proposed. A confirmation
you can lie to is theatre.

**Agent attribution is ambient, not a parameter.**

`asAgent()` wraps the whole execution in an `AsyncLocalStorage` scope, and the
audit writes read `agentInitiated()` from it. The alternative — an
`agentInitiated` flag threaded through every mutation — is correct on the day
it is written and wrong the first time someone adds a mutation or the
assistant reaches a code path indirectly. A missing flag is invisible: the
audit row still looks right, it just credits a person with something an agent
did.

The actor stays the human, per §4.6. Nobody hides behind "the assistant did
it".

## Consequences

**Good**

- The agent's entire reach is seven functions. No shell, no SQL, no fetch, no
  tool it can define.
- The assistant inherits every validation, conflict rule and notification
  behaviour the UI has, because it calls the same functions. It cannot drift
  from them, because there is nothing to drift from.
- The permission matrix for the assistant is testable with no session, no
  database and no model — `tests/assistant/tools.test.ts` iterates tools ×
  roles × subject relationships and checks each against `can()`.

**Costs, accepted**

- Two round trips per change instead of one, and a person in the middle. That
  is the feature.
- A plan can go stale between proposal and confirmation. `performPlan` re-reads
  the meeting rather than sealing its fields, so a change someone else made in
  the meantime survives instead of being reverted — but a meeting cancelled in
  that window makes its row fail, and the card says so.
- The model cannot verify its own work. It stages and stops. Anything it got
  wrong is caught by the person reading the card, which is the only reviewer
  that matters here.

**Deliberately not built**

- `search_transcripts`, from §4.6's list. There are no transcripts yet
  (§4.5 is unbuilt). A tool that always returns nothing teaches the model to
  stop calling it, and teaches a reviewer that the feature exists.
- Voice input. §4.6 says text first.
- Streaming. The design draws a shimmer skeleton, not a typewriter, and the
  answer is one or two sentences above a card. Streaming would add machinery
  to make a short sentence arrive in pieces.

## Notes on the model configuration

`claude-opus-5`, adaptive thinking, `effort: medium`, `strict: true` on every
tool schema, a manual loop bounded at six turns.

`medium` rather than the `high` default: someone is watching a spinner in a
480px panel, and on a seven-tool surface with no ambiguity about which tool
applies, more deliberation buys latency rather than accuracy. This is the one
setting here worth re-tuning against real usage.

The loop is written by hand rather than using the SDK's tool runner, because
it has a side channel — write tools return a staged action alongside the text
the model sees, and those staged actions are the plan. Owning the loop keeps
that obvious and keeps a beta API out of a codebase that is otherwise on
stable ones.

Refusals (`stop_reason: "refusal"`) are handled explicitly: they arrive as a
successful response with empty content, so reading `content[0]` first would
throw on the one path that most needs a clear message. Server-side fallbacks
are deliberately not configured — an internal scheduling assistant with a
fixed seven-tool surface has no plausible refusal path, and a fallback model
is a thing to maintain.
