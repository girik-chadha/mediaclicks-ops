import { fromWallClock, toWallClock } from '../time'

/**
 * When notifications are due. Pure, so the scheduling rules can be tested
 * without a database, a clock, or a worker.
 */

/**
 * The instant a reminder for this meeting should fire, for someone whose
 * lead time is `leadMinutes`.
 *
 * Deliberately derived rather than stored: it is a function of the meeting's
 * start and the person's preference, both of which can change. Storing it
 * would mean invalidating rows every time either moved.
 */
export function reminderAt(startsAt: Date, leadMinutes: number): Date {
  return new Date(startsAt.getTime() - leadMinutes * 60_000)
}

/**
 * Whether a reminder is due now.
 *
 * The window is half-open on both sides: due once the lead time is reached,
 * and never after the meeting has started — a reminder that arrives during
 * the call is worse than none, because it implies there is still time.
 */
export function reminderIsDue(
  startsAt: Date,
  leadMinutes: number,
  now: Date,
): boolean {
  const at = reminderAt(startsAt, leadMinutes)
  return now.getTime() >= at.getTime() && now.getTime() < startsAt.getTime()
}

/**
 * The instant today's digest should fire for someone in `zone` whose digest
 * time is `hhmm`.
 *
 * The conversion has to go through the zone rather than adding an offset:
 * "08:00 local" is a different instant in Kolkata and in London, and a
 * different instant in London in June than in December.
 */
export function digestAt(hhmm: string, zone: string, on: Date): Date {
  const [hour = 8, minute = 0] = hhmm.split(':').map(Number)
  const wall = toWallClock(on, zone)
  return fromWallClock(
    { year: wall.year, month: wall.month, day: wall.day, hour, minute },
    zone,
  )
}

/**
 * Whether today's digest is due.
 *
 * Bounded by `graceMinutes` so a worker that was asleep at 08:00 still sends
 * at 08:20, but one that has been down since yesterday does not send a digest
 * at midnight for a day that is nearly over.
 */
export function digestIsDue(
  hhmm: string,
  zone: string,
  now: Date,
  graceMinutes = 120,
): boolean {
  const at = digestAt(hhmm, zone, now)
  const elapsed = now.getTime() - at.getTime()
  return elapsed >= 0 && elapsed < graceMinutes * 60_000
}
