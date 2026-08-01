/**
 * Timezone arithmetic. Pure, no dependencies, no database.
 *
 * Every instant is stored UTC and rendered in a named IANA zone (§4.1). The
 * hard part is the inverse — turning a wall-clock time in a zone back into an
 * instant — because the offset depends on the instant you are trying to find.
 * Around a DST transition a naive single-pass conversion is an hour wrong,
 * which for a scheduling product means people miss calls.
 */

/** How far `zone` is ahead of UTC at this instant, in milliseconds. */
export function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const at = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')

  // Intl renders midnight as hour 24 in some engines; normalise it.
  const asIfUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour') % 24,
    at('minute'),
    at('second'),
  )

  return asIfUtc - instant.getTime()
}

export interface WallClock {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

/** The wall-clock reading a person in `zone` sees at this instant. */
export function toWallClock(instant: Date, zone: string): WallClock {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, zone))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

/**
 * The instant at which `zone` reads this wall-clock time.
 *
 * Two passes. The first guesses using the offset at the naive UTC instant;
 * the second corrects using the offset at the guessed instant, which is what
 * makes DST boundaries come out right. Times that do not exist (the spring-
 * forward gap) resolve forward, and ambiguous times (the autumn repeat)
 * resolve to the first occurrence — both are the conventional choices.
 */
export function fromWallClock(wall: WallClock, zone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  const firstPass = naive - zoneOffsetMs(new Date(naive), zone)
  const secondPass = naive - zoneOffsetMs(new Date(firstPass), zone)
  return new Date(secondPass)
}

/** Midnight starting the day that contains `instant`, in `zone`. */
export function startOfDay(instant: Date, zone: string): Date {
  const { year, month, day } = toWallClock(instant, zone)
  return fromWallClock({ year, month, day, hour: 0, minute: 0 }, zone)
}

/** Monday 00:00 of the week containing `instant`, in `zone`. */
export function startOfWeek(instant: Date, zone: string): Date {
  const dayStart = startOfDay(instant, zone)
  const weekday = new Date(dayStart.getTime() + zoneOffsetMs(dayStart, zone)).getUTCDay()
  // getUTCDay is 0=Sunday; the calendar starts Monday.
  const backtrack = (weekday + 6) % 7
  return addDays(dayStart, -backtrack, zone)
}

/**
 * Adds days in the given zone, preserving wall-clock time.
 *
 * Not `+ n * 86_400_000`: across a DST boundary that shifts the hour, so
 * "same time tomorrow" would drift.
 */
export function addDays(instant: Date, days: number, zone: string): Date {
  const wall = toWallClock(instant, zone)
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days))
  return fromWallClock(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: wall.hour,
      minute: wall.minute,
    },
    zone,
  )
}

/** Minutes since local midnight, 0–1440. Drives the playhead and grid rows. */
export function minutesIntoDay(instant: Date, zone: string): number {
  const { hour, minute } = toWallClock(instant, zone)
  return hour * 60 + minute
}

/** Whether two half-open intervals overlap. Touching endpoints do not. */
export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

export function sameZonedDay(a: Date, b: Date, zone: string): boolean {
  const x = toWallClock(a, zone)
  const y = toWallClock(b, zone)
  return x.year === y.year && x.month === y.month && x.day === y.day
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `09:30` in the given zone. */
export function formatTime(instant: Date, zone: string): string {
  const { hour, minute } = toWallClock(instant, zone)
  return `${pad(hour)}:${pad(minute)}`
}

/** `09:30–10:30`. An en dash, per the design. */
export function formatRange(start: Date, end: Date, zone: string): string {
  return `${formatTime(start, zone)}–${formatTime(end, zone)}`
}

export function durationMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000)
}

/** `45m`, `1h`, `1h 30m` — §8 wants specifics, not "a while". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** `Starts in 12 minutes` / `Started 5 minutes ago` (§8). */
export function relativeToNow(start: Date, now: Date): string {
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000)
  if (minutes === 0) return 'Starting now'
  if (minutes > 0) {
    if (minutes < 60) return `Starts in ${minutes} minute${minutes === 1 ? '' : 's'}`
    const hours = Math.floor(minutes / 60)
    return `Starts in ${hours} hour${hours === 1 ? '' : 's'}`
  }
  const past = Math.abs(minutes)
  if (past < 60) return `Started ${past} minute${past === 1 ? '' : 's'} ago`
  const hours = Math.floor(past / 60)
  return `Started ${hours} hour${hours === 1 ? '' : 's'} ago`
}
