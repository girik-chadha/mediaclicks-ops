# ADR 0010 — Two-step sign-in, and a session window that is actually enforced

**Status:** accepted
**Date:** 2026-09-09

## Context

Three requirements arrived together, and they interact:

1. "Keep me signed in on this device" — a longer session when ticked, a short
   one when not.
2. A code emailed at sign-in, verified before a session exists.
3. Google sign-in restricted to people who already have accounts.

The obvious implementation of each one is wrong in a way that does not show
up until it matters.

## Decision

### The session window is a claim we check, not the token's own expiry

The natural approach is to set `token.exp` in the `jwt` callback — short for a
guest, long for a remembered device — and let the JWT expire itself.

It does not work. `@auth/core/jwt`'s `encode()` ends with

```js
.setExpirationTime(now() + maxAge)
```

unconditionally, where `maxAge` is the single static value from the session
config. Anything a callback writes to `exp` is overwritten on the way out.

The failure is silent and in the dangerous direction: sign-in succeeds, the
checkbox appears to work, and **every** session lasts thirty days including
the ones that asked not to. A security control that is only decorative is
worse than none, because people rely on it — someone ticks nothing on a
borrowed laptop and believes they are covered.

So the deadline travels as an ordinary claim (`expiresAt`) and is checked on
every request: in `getActor()`, which is the real authorization boundary, and
in the middleware's `authorized()` so the redirect happens before a page
renders. `session.maxAge` becomes the outer ceiling rather than the answer.

This is the same stance as ADR 0005, which resolves permissions per request
rather than carrying them in the token: **a token you trust is a token you
cannot revoke.** A session window is that problem with a clock on it.

`src/lib/auth/session-window.ts` holds it, pure, with no imports — so the
whole behaviour is provable without a browser, a database or a running app.

**Absolute, not sliding.** The deadline is stamped once at sign-in and never
recomputed. A sliding window would mean an unremembered session never ending
so long as a tab stays open, and "12 hours" quietly becoming "12 hours after
you stop", which is not what the checkbox says.

**Twelve hours, not "until the browser closes."** A session cookie with no
`Max-Age` is the traditional reading of an unticked box, and in practice it
does not expire: every major browser restores tabs and cookies on relaunch by
default, so the promise silently fails. Twelve hours is one working day and
the server enforces it.

**A missing deadline is not treated as expired.** Sessions minted before this
shipped carry no claim. Failing them closed would sign the entire agency out
on deploy, for a control none of them was offered. They stay bounded by the
same thirty-day cap that governed them yesterday.

### The second factor cannot be switched on into a lockout

`AUTH_2FA=required` on its own would brick the product the moment it were set
before email worked: no code can be sent, so no session can be created, so
nobody — including the owner who set the variable — can get in to unset it.
There is no recovery path from inside the product.

So it requires two conditions: the variable **and** a configured mailer
(`twoFactorDecision`, tested in `tests/auth/two-factor.test.ts`). The variable
can be set ahead of time and starts demanding a code once there is a way to
deliver one.

This leaves the opposite failure — email breaks and the factor stops being
asked for. Accepted deliberately as the lesser one: it is visible (the login
screen stops mentioning a code) and recoverable, where a lockout is
recoverable by nobody inside the agency. Near-misses (`"true"`, `"REQUIRED"`,
`"1"`) are also refused, so a typo in an environment variable cannot shut
everyone out either.

### The password check moved out of `authorize()`

`authorize()` can only answer yes or no — a user and a session, or null and
none. It cannot express "correct password, not finished yet".

So `startLoginChallenge()` checks the password and issues a code, and
`authorize()` is handed the *result of the code check* instead. That split is
also what makes the flow safe: no session exists until the code is accepted,
so knowing a password gets an attacker a challenge row and an email to
somebody else's inbox.

**And `authorize()` refuses a bare password whenever a second factor is
required — before looking at it.** `/api/auth/callback/credentials` is a
public endpoint; anyone can POST to it. Enforcing the second step only in the
UI would make the UI a suggestion, bypassable by anyone who read the network
tab once.

The handoff between the two steps is a signed sixty-second grant
(`grant.ts`), not a re-submitted password — carrying a password across two
screens so it can be re-checked at the end is worse than the problem it
solves. It is a separate mechanism from the assistant's `seal()` despite the
identical construction: that one is bound to an actor who is already signed
in and lives fifteen minutes, this one *creates* the signed-in actor and must
live seconds. Sharing them would mean one TTL serving two threat models, and
login inheriting the looser one.

### The Google allowlist is the `users` table

"Only registered emails may use Google" is exactly "an active row already
exists in `users`". A separate allowlist would be two places to add someone
and two places to forget to remove them — and the Team screen is already
where people are added and deactivated.

No account is ever created from a Google profile, and an unverified Google
email is refused outright: Google will hand out a profile whose address the
holder has never demonstrated they own.

Google sign-in does not then also demand an emailed code. Google has already
proved control of that mailbox more strongly than a six-digit code sent to
it; asking for one afterwards would be theatre.

### The login hero shows nothing real

The design binds the panel's bottom list to live meetings. Wired to the real
table that publishes the agency's client roster and today's schedule at a
public, unauthenticated URL — a competitor could learn who MediaClicks works
with, and when, by loading the login page. The mockup could not have known;
it had no database behind it.

The shape is kept and the rows are fixed and anonymous. What stays true is
what the brief actually asked the panel for — that the product looks alive
before you are let in — because the clock and the Rail's playhead beside it
are genuinely live in the viewer's own zone.

## Consequences

**Good**

- The checkbox is provable: `tests/auth/session-window.test.ts` pins both
  windows, the absolute deadline, and the deploy-day case, with no harness.
- The second factor cannot be bypassed by talking to the endpoint directly,
  and cannot be switched on into an unrecoverable state.
- Adding or removing someone's Google access is the same action as adding or
  removing them from the team. There is no second list to drift.

**Costs, accepted**

- Two round trips to sign in when the factor is on, and a code to fetch from
  an inbox. That is the feature.
- The window is enforced in two places (`getActor` and `authorized`) rather
  than by the library. Middleware alone would not do: a server action reaches
  `requireActor()` without passing the matcher.
- A grant is replayable for sixty seconds. Bounded by the challenge being
  consumed in the same transaction that validated the code, so a replay
  yields the same session for the same person rather than new authority.

**Deliberately not built**

- TOTP or hardware keys. The requirement was a code to the email on the
  account; an authenticator app is a different product decision and a worse
  first one for a 5–25 person agency with no device policy.
- Trusted-device memory, so the code is asked for once per device rather than
  once per sign-in. Wanted eventually; it needs a device identifier that is
  not a fingerprint, and it should not be invented in the same change that
  introduces the factor itself.
