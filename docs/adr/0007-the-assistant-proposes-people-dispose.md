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

The planner has no way to reach a write. There is no tool it can call, no
argument it can pass, and no sequence of calls that ends in a database write.
The only code path to an effect is `performPlan()`, and the only caller of
that is the Confirm button.

**Authorization is checked twice, for two different reasons.**

At planning time, `requirePermission()` runs so the refusal reaches the
person in their own words — "Emma can't edit other people's meetings" — rather
than as a card that fails on Confirm. At execution time it runs again, inside
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
- The planner is a seam, not a hard-coded step. It returns `AssistantReply`
  and nothing downstream knows how the reply was produced.

**Costs, accepted**

- Two round trips per change instead of one, and a person in the middle. That
  is the feature.
- A plan can go stale between proposal and confirmation. `performPlan` re-reads
  the meeting rather than sealing its fields, so a change someone else made in
  the meantime survives instead of being reverted — but a meeting cancelled in
  that window makes its row fail, and the card says so.
- The planner cannot verify its own work. It stages and stops. Anything it
  got wrong is caught by the person reading the card, which is the only
  reviewer that matters here.

**Deliberately not built**

- `search_transcripts`, from §4.6's list. There are no transcripts yet
  (§4.5 is unbuilt), and a tool that always returns nothing teaches a
  reviewer the feature exists when it does not.
- Voice input. §4.6 says text first.
- Streaming. The design draws a shimmer skeleton, not a typewriter, and the
  answer is one or two sentences above a card. Streaming would add machinery
  to make a short sentence arrive in pieces.

---

## Amendment, 2026-08-03 — the planner is a grammar, not a model

**Status:** accepted, supersedes the model-backed planner shipped earlier the
same day.

### What changed

The first implementation put Claude behind the panel: a tool-calling loop
that turned a sentence into staged actions. It worked. It also cost money per
request, and the owner's requirement is that this software runs at zero
marginal cost — an internal tool for a small agency cannot carry a per-use
bill, and one that stops working when a credit balance runs out is worse than
one that never promised more than it does.

So the planner was replaced with a deterministic grammar
(`src/lib/assistant/parse.ts`) and the SDK removed from the project.

### Why this was cheap to do

Nothing downstream changed. Not one line of the tool layer, the permission
check, the seal, the execution path, the audit flag, or the panel's four
states. The seam held: `planFromPrompt()` returns the same `AssistantReply`
the model-backed loop returned, and everything that makes this feature
defensible sits on the far side of it.

That is the argument for having built it this way, made concrete. The
interesting part of §4.6 was never the language model — it was that a
proposal and an effect are different things, and that authorization has one
door.

### What was traded

- **Breadth.** The grammar understands a listed set of phrasings and refuses
  everything else, showing what it can do. A model would have understood
  "shuffle things so I get a clear morning"; this does not, and says so.
- **Graceful degradation on unusual input.** A model misunderstands visibly
  and asks. A regex misunderstands *confidently*. That is why the resolver
  never picks between two meetings matching a title — it lists them and asks
  which — and why the parser refuses rather than falling back to a best
  guess. Confident wrongness in front of a Cancel button is the failure mode
  worth engineering against.

### What was gained beyond the cost

- No key to manage, no rate limit, no provider outage, no free tier to
  expire, nothing to rotate.
- The planner is exhaustively testable. `tests/assistant/parse.test.ts` and
  `when.test.ts` pin every accepted phrasing, every refusal, and the two
  genuinely ambiguous rules in English — which Thursday "Thursday" means, and
  which one "next Thursday" means. Neither could have been pinned about a
  model; both are now facts about the product.
- Identical behaviour locally and deployed, because there is nothing to
  configure.

### If the model comes back

`planFromPrompt` is the only thing to reimplement, and the grammar makes a
reasonable fast path in front of one: parse first, fall through to a model
only on a refusal. Nothing else would move.
