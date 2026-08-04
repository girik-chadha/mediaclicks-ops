import { addDays, formatRange, sameZonedDay, startOfDay } from '@/lib/time'

/**
 * How the assistant states a time.
 *
 * `formatRange` gives "09:00–10:00" and nothing else, which is right inside
 * a calendar cell — the column already says which day. Everywhere the
 * assistant speaks there is no column, and a list of five slots reading
 * 09:00, 09:30, 10:00 is not an answer to "when next week is everyone
 * free". Worse on a confirmation card: "moves to 15:00–15:30" asks someone
 * to approve a change without telling them what day it lands on.
 *
 * So every time the assistant prints goes through here, and carries its day
 * unless the day is today.
 */
export function whenLabel(start: Date, end: Date, zone: string, now: Date): string {
  return `${dayLabel(start, zone, now)} · ${formatRange(start, end, zone)}`
}

/** Same, for a single instant. */
export function atLabel(instant: Date, zone: string, now: Date): string {
  const time = formatRange(instant, instant, zone).split('–')[0]
  return `${dayLabel(instant, zone, now)} · ${time}`
}

/**
 * "Today", "Tomorrow", "Yesterday", else "Mon 10 Aug".
 *
 * Relative words only for the three days a person holds in their head
 * without counting. Beyond that the date is shorter to read than the
 * arithmetic.
 */
export function dayLabel(instant: Date, zone: string, now: Date): string {
  if (sameZonedDay(instant, now, zone)) return 'Today'

  const today = startOfDay(now, zone)
  if (sameZonedDay(instant, addDays(today, 1, zone), zone)) return 'Tomorrow'
  if (sameZonedDay(instant, addDays(today, -1, zone), zone)) return 'Yesterday'

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: zone,
  })
    .format(instant)
    .replace(/,/g, '')
}

/** Groups slots by day so a list of options reads as "Mon: a, b · Tue: c". */
export function groupByDay(
  slots: readonly { startsAt: Date; endsAt: Date }[],
  zone: string,
  now: Date,
): { day: string; times: string[] }[] {
  const out: { day: string; times: string[] }[] = []
  for (const s of slots) {
    const day = dayLabel(s.startsAt, zone, now)
    const last = out.at(-1)
    const time = formatRange(s.startsAt, s.endsAt, zone)
    if (last && last.day === day) last.times.push(time)
    else out.push({ day, times: [time] })
  }
  return out
}
