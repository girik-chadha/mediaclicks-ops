# ADR 0008 — Permission decides the path

**Status:** accepted
**Date:** 2026-08-04

## Context

ADR 0007 gave the assistant one answer when someone asked for a change they
were not allowed to make: a refusal, phrased for a person — "Emma can't edit
other people's meetings."

That is honest and it is useless. The thing the person wanted to happen is
still a reasonable thing to want; they are simply not the one who may do it.
Telling them no and stopping leaves them to go and find the right person by
hand, which is the coordination work the tool exists to remove.

The owner's rule: *"if the person already has the perks and is on the role
where they can be changing their meetings and giving it to others then they
can do that; if they can't then it will go for approval first."*

## Decision

**Permission chooses between two paths, and never gates a dead end.**

- May do it → the assistant stages the change. Confirm performs it. This is
  ADR 0007 unchanged.
- May not → the assistant stages a **request**. Confirm sends it to someone
  who may, in their chat, from "Assistant". They approve or deny.

The card looks the same and the button says the same word. The consequence
differs, and the sentence above the card says which: *"That is not yours to
change, so I will ask Priya instead."*

**The approver's authority executes it.**

This is the load-bearing decision. On approval the change runs as the
approver, and `requirePermission` runs again at that moment, as them. So:

- Nobody acquires a permission by asking. They acquire a conversation.
- The change is always performed by someone entitled to perform it.
- If the approver's own permission was revoked between the request arriving
  and them answering, the approval fails and says so, rather than executing
  on the strength of a permission that existed yesterday.

The approver is the meeting's creator — the person holding
`meeting.edit.own` over it. If there is no such person other than the
requester, there is nobody to ask, and the refusal stands.

**The bot has a name and no account.**

The chat message carries `author_user_id: null` and `author_name:
"Assistant"`. A bot with a user row would be a member of the organisation:
addable to meetings, counted in the team, needing permissions of its own,
and one join away from appearing in every people-picker in the app. A name
with no account cannot be any of those things.

**The request is frozen at the moment it is made.**

`payload` and `summary` are stored, not recomputed. Approving does exactly
what was asked for, not what the same sentence would resolve to a day later
when "Thursday" means a different Thursday. The two people are also looking
at the same words, which is what makes an approval an agreement.

## Consequences

**Good**

- The refusal path shrinks to the case where it is genuinely correct:
  nobody to ask.
- `request_approval` needs no permission of its own — asking has no effect —
  which the tool-permission matrix now records explicitly rather than
  leaving as an omission.
- Both routes share `asUpdateInput`, so a rule about what a valid edit looks
  like cannot apply to one path and not the other.
- Every step writes an audit row: `approval.requested`, then
  `approval.approved` / `approval.denied`, all flagged agent-initiated with
  the deciding human as actor.

**Costs, accepted**

- A second table, and a state machine with four states. The CHECK constraint
  keeps `status` and `decided_at` from disagreeing, because they are two
  halves of one fact.
- A second table, and one more thing the notification tick does.

## Follow-ups, now built

**Stale requests are swept.** A pending request on a meeting that has
started or been cancelled can no longer be answered honestly — approving it
would do nothing, or something absurd — and leaving live buttons in the
approver's chat invites exactly that. `sweepStaleApprovals` runs in the
notification tick, withdraws them with the reason, and tells the requester
so they are not waiting on an answer that is never coming. The status is
re-checked inside the transaction, so an approver who answers in the same
moment wins over the sweep.

It lives in its own module rather than beside the rest of approvals. Not for
length: it runs from cron, which has no session, and importing it from a
file that reaches `requireActor` would drag Auth.js into a code path with no
user in it. Same discipline that keeps argon2 out of the Edge bundle.

**Approvals lead "Needs you" on Home.** Chat is where the request arrives,
but someone who has not opened chat has not seen it. The Home surface
already derives its items from real rows, and a pending approval is the most
literal thing that could be on it: another person is blocked until this one
answers. It sorts above the other items for that reason.

**Deliberately not built**

- Delegating approval, or approving on someone's behalf. Both re-open the
  question this ADR closes.
- Approval for `create_meeting`. Booking your own time needs no permission
  from anyone, and booking someone else's is already gated by
  `meeting.create.any` at the point the meeting is proposed.
