import type { PermissionKey } from './keys'

/**
 * The authorization decision function (§3).
 *
 * This module is deliberately pure: no database, no session, no Auth.js, no
 * `server-only`. Three things fall out of that, and they are the reason for
 * the constraint rather than side effects of it.
 *
 *  1. The permission matrix is testable exhaustively with no mocking at all.
 *  2. It runs in a React render, so the UI can hide controls with the same
 *     function the server enforces with — no second, drifting copy of the
 *     rules.
 *  3. §4.6's assistant tools call it directly. "The agent cannot do anything
 *     the user could not do by clicking" becomes structurally true, because
 *     there is no other code path to authorization, rather than true because
 *     someone remembered to check.
 *
 * `requirePermission()` is the session-aware wrapper that throws. It lives in
 * src/server/auth and is allowed to know about Auth.js. This file is not.
 */

/* ── The two kinds of permission ──────────────────────────────────────────
   Flat permissions are about the actor alone. Scoped actions are about the
   actor's relationship to a particular thing, and come in own/elevated pairs.
                                                                            */

export const FLAT_PERMISSIONS = [
  'client.manage',
  'user.invite',
  'user.manage',
  'role.manage',
] as const satisfies readonly PermissionKey[]

export type FlatPermission = (typeof FLAT_PERMISSIONS)[number]

export const SCOPED_ACTIONS = [
  'meeting.create',
  'meeting.edit',
  'meeting.delete',
  'meeting.view',
  'transcript.view',
] as const

export type ScopedAction = (typeof SCOPED_ACTIONS)[number]

export type Action = FlatPermission | ScopedAction

/**
 * Call sites name the *action*, not the scoped key.
 *
 * `can(user, 'meeting.edit.own')` answers the wrong question — it cannot tell
 * you whether this user may edit *this* meeting. Every call site would then
 * write `can(u, 'meeting.edit.any') || (can(u, 'meeting.edit.own') && m.createdBy === u.id)`,
 * and that duplicated ownership test across twenty endpoints is exactly where
 * an authorization bug lives. Resolving own-vs-elevated here means it is
 * written once.
 */
const SCOPE = {
  'meeting.create': { own: 'meeting.create.own', elevated: 'meeting.create.any' },
  'meeting.edit': { own: 'meeting.edit.own', elevated: 'meeting.edit.any' },
  'meeting.delete': { own: 'meeting.delete.own', elevated: 'meeting.delete.any' },
  // §3 uses `.all` for the two view permissions and `.any` for the rest.
  // Held as data rather than derived by appending a suffix, so the asymmetry
  // is explicit and `satisfies` catches a typo at compile time.
  'meeting.view': { own: 'meeting.view.own', elevated: 'meeting.view.all' },
  'transcript.view': { own: 'transcript.view.own', elevated: 'transcript.view.all' },
} as const satisfies Record<ScopedAction, { own: PermissionKey; elevated: PermissionKey }>

/** Every key reachable through a scoped action. Used by the exhaustiveness test. */
export const SCOPED_KEYS: readonly PermissionKey[] = SCOPED_ACTIONS.flatMap((a) => [
  SCOPE[a].own,
  SCOPE[a].elevated,
])

/* ── Who counts as an owner ───────────────────────────────────────────── */

export interface Actor {
  readonly id: string
  readonly orgId: string
  /** Flattened from every role the user holds, resolved once per request. */
  readonly permissions: ReadonlySet<PermissionKey>
}

export interface Subject {
  readonly orgId: string
  readonly createdByUserId: string
  /** For meeting.create this is the *intended* attendee set (§4.1.1). */
  readonly attendeeIds?: readonly string[]
}

const isCreator = (actor: Actor, subject: Subject): boolean =>
  subject.createdByUserId === actor.id

const isAttendee = (actor: Actor, subject: Subject): boolean =>
  subject.attendeeIds?.includes(actor.id) ?? false

/**
 * "Own" means different things per action, so it is a predicate per action
 * rather than one shared ownership test.
 */
const OWNS: Record<ScopedAction, (actor: Actor, subject: Subject) => boolean> = {
  // Being invited to something is enough to read it. It is not enough to
  // change it.
  'meeting.view': (a, s) => isCreator(a, s) || isAttendee(a, s),
  'transcript.view': (a, s) => isCreator(a, s) || isAttendee(a, s),

  'meeting.edit': isCreator,
  'meeting.delete': isCreator,

  // §4.1.1: "Requires meeting.create.any to add anyone other than yourself."
  // At creation time the subject is not a meeting yet — it is the attendee
  // set being proposed, so that is the only field consulted.
  'meeting.create': (a, s) => (s.attendeeIds ?? [a.id]).every((id) => id === a.id),
}

const SCOPED_SET: ReadonlySet<string> = new Set(SCOPED_ACTIONS)

/**
 * Exported so callers holding a widened `Action` can narrow before calling
 * `can`, rather than casting past the variadic signature. `requirePermission`
 * uses it for exactly that.
 */
export function isScopedAction(action: Action): action is ScopedAction {
  return SCOPED_SET.has(action)
}

/**
 * Does `actor` have permission to perform `action`?
 *
 * The variadic conditional tuple makes the subject required exactly when the
 * action needs one: forgetting it on `meeting.edit` is a compile error, and
 * passing one to `client.manage` is too. Same principle §4.1.1 applies to the
 * create-meeting form — make the invalid call unrepresentable rather than
 * catching it at runtime.
 *
 *   can(actor, 'client.manage')
 *   can(actor, 'meeting.edit', meeting)
 */
export function can<A extends Action>(
  actor: Actor,
  action: A,
  ...rest: A extends ScopedAction ? [subject: Subject] : []
): boolean
export function can(actor: Actor, action: Action, subject?: Subject): boolean {
  // 1. Tenant gate, before any permission logic. A permission is a statement
  //    about your own organisation and never reaches across one, so no grant
  //    — not even Owner's — can pass this.
  if (subject && subject.orgId !== actor.orgId) return false

  // 2. Flat permissions are a straight membership test.
  if (!isScopedAction(action)) return actor.permissions.has(action)

  // A scoped action without a subject cannot be decided. Unreachable through
  // the public signature; guarded because `can` is the last line of defence
  // and JavaScript callers do not typecheck.
  if (!subject) return false

  const { own, elevated } = SCOPE[action]

  // 3. Elevated grant answers for any subject in the org.
  if (actor.permissions.has(elevated)) return true

  // 4. Otherwise the own grant, and only over what the actor owns.
  if (actor.permissions.has(own)) return OWNS[action](actor, subject)

  // 5. Deny by default.
  return false
}
