import type { Action } from '@/lib/permissions'

/**
 * The assistant's tool catalogue (§4.6).
 *
 * Pure, like src/lib/permissions: no database, no session. That is what
 * lets the permission test iterate every tool against every role without
 * mocking anything.
 *
 * Two properties are declared here rather than left to each executor to
 * remember, because both are load-bearing:
 *
 *   `action`  — the permission the tool needs. Held as data so a test can
 *               assert, over the cartesian product of tools and roles, that
 *               a tool is reachable exactly when can() says the action is.
 *               A tool added later with no entry fails that test, so the
 *               failure mode is a red build rather than a silently
 *               unguarded capability.
 *
 *   `effect`  — 'read' runs immediately; 'write' is *staged* and executes
 *               only after the human confirms. The distinction is a
 *               property of the tool, not a judgement made at runtime.
 *
 * The toolset is fixed and small. There is no shell, no SQL, no fetch, and
 * nothing that can define a new tool. The assistant's entire reach is these
 * seven functions.
 */

export const TOOL_NAMES = [
  'list_team',
  'list_clients',
  'list_my_meetings',
  'find_free_slot',
  'create_meeting',
  'reschedule_meeting',
  'cancel_meeting',
  'reassign_meeting',
  'notify_user',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

export interface ToolSpec {
  readonly name: ToolName
  readonly effect: 'read' | 'write'
  /**
   * Null means the tool needs no permission — not that it is unguarded.
   * Every executor is still org-scoped, so `list_team` cannot see another
   * organisation's people. It means only that no §3 key gates it, because
   * no key gates the equivalent click either: anyone can open the team list
   * or send a colleague a message.
   */
  readonly action: Action | null
}

export const TOOLS: readonly ToolSpec[] = [
  { name: 'list_team', effect: 'read', action: null },
  { name: 'list_clients', effect: 'read', action: null },
  { name: 'list_my_meetings', effect: 'read', action: 'meeting.view' },
  { name: 'find_free_slot', effect: 'read', action: 'meeting.view' },
  // meeting.create, not .edit: §4.1.1 makes adding anyone other than
  // yourself require meeting.create.any, and the subject a create is judged
  // against is the proposed attendee set rather than an existing row.
  { name: 'create_meeting', effect: 'write', action: 'meeting.create' },
  { name: 'reschedule_meeting', effect: 'write', action: 'meeting.edit' },
  { name: 'cancel_meeting', effect: 'write', action: 'meeting.delete' },
  { name: 'reassign_meeting', effect: 'write', action: 'meeting.edit' },
  { name: 'notify_user', effect: 'write', action: null },
]

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

export function toolSpec(name: string): ToolSpec | undefined {
  return BY_NAME.get(name as ToolName)
}

/** Working hours used by find_free_slot. The team is in one place (IST). */
export const WORK_START_MINUTE = 9 * 60
export const WORK_END_MINUTE = 18 * 60
/** Sunday = 0. Saturday and Sunday are not offered. */
export const WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5]
