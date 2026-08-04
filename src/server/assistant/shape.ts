import 'server-only'
import { meetingUpdateInput, type MeetingUpdateInput } from '@/lib/meetings/schema'
import type { MeetingRow } from '../meetings/queries'

/**
 * Rebuilds the full edit payload from the current row.
 *
 * updateMeeting takes the whole meeting rather than a patch, deliberately
 * (§4.1.1: one modal, prefilled). Reading the row at execution time rather
 * than sealing its fields into the plan means a field someone else changed
 * in the meantime is preserved instead of being reverted to what it was
 * when the plan was made.
 *
 * Parsed rather than cast. The stored row is wider than the input type —
 * `type: 'client'` with no provider is representable in TypeScript's view of
 * the column even though neither the form nor the CHECK constraint allows
 * it — and parsing turns "cannot happen" into a caught error instead of a
 * cast that would be wrong exactly when it mattered.
 *
 * Lives here rather than in execute.ts because both the direct route and
 * the approval route need it, and a second copy would be a second set of
 * rules for the same write.
 */
export function asUpdateInput(m: MeetingRow): MeetingUpdateInput {
  return meetingUpdateInput.parse({
    id: m.id,
    title: m.title,
    description: m.description ?? undefined,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    type: m.type,
    clientId: m.clientId ?? undefined,
    conferencingProvider: m.conferencingProvider,
    conferenceUrl: m.conferenceUrl ?? undefined,
    attendeeIds: m.attendeeIds,
  })
}
