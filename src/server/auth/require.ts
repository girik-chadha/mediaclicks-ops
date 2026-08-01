import 'server-only'
import {
  can,
  isScopedAction,
  type Action,
  type ScopedAction,
  type Subject,
} from '@/lib/permissions'
import { requireActor, type SessionActor } from './session'

/**
 * The session-aware half of authorization.
 *
 * `can()` returns a boolean, and a boolean is ignorable — nothing stops a
 * route handler from calling it and not reading the answer. Mutations use
 * this instead, which throws, so forgetting to act on the result is not a
 * shape the code can take.
 *
 * This layer is allowed to know about Auth.js. src/lib/permissions is not.
 */

/** Phrasing for §8's copy voice: state what the person can't do, plainly. */
const PHRASE: Record<Action, string> = {
  'meeting.create': "create meetings for other people",
  'meeting.edit': "edit other people's meetings",
  'meeting.delete': "delete other people's meetings",
  'meeting.view': "view other people's meetings",
  'transcript.view': "view other people's transcripts",
  'client.manage': 'manage clients',
  'user.invite': 'add people to the team',
  'user.manage': 'manage team members',
  'role.manage': 'change roles and permissions',
}

export class ForbiddenError extends Error {
  override readonly name = 'ForbiddenError'

  constructor(
    readonly actorId: string,
    readonly action: Action,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Throws unless the current actor may perform `action`.
 *
 * Returns the actor so the caller does not resolve the session twice:
 *
 *   const actor = await requirePermission('meeting.edit', meeting)
 */
export async function requirePermission<A extends Action>(
  action: A,
  ...rest: A extends ScopedAction ? [subject: Subject] : []
): Promise<SessionActor>
export async function requirePermission(
  action: Action,
  subject?: Subject,
): Promise<SessionActor> {
  const actor = await requireActor()

  // Narrow rather than cast past the variadic signature, so each branch
  // typechecks against the real `can` overload.
  const allowed = isScopedAction(action)
    ? can(actor, action, subject as Subject)
    : can(actor, action)

  if (!allowed) {
    // "Emma can't edit other people's meetings" — not "Insufficient
    // permissions". The person reading this needs to know what to ask for.
    const firstName = actor.fullName.split(' ')[0] ?? actor.fullName
    throw new ForbiddenError(
      actor.id,
      action,
      `${firstName} can't ${PHRASE[action]}`,
    )
  }

  return actor
}
