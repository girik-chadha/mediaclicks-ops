'use client'

import { providerCode, providerLabel } from '@/lib/meetings/schema'
import { formatRange, formatTime, relativeToNow } from '@/lib/time'
import { useNow } from '@/components/shell/use-now'
import { isTimeCritical, meetingState } from '@/components/calendar/encoding'
import type { MeetingDto } from '@/components/calendar/types'

/**
 * The Today screen (brief §6.1) — the most important screen in the product.
 *
 * Above the fold: the next meeting rendered large, with a countdown in
 * --live if it is within 30 minutes. Below it, the rest of the day as a
 * vertical log, hairline-separated, time on the left. Past meetings dim.
 */
export function DayLog({ meetings, zone }: { meetings: MeetingDto[]; zone: string }) {
  const now = useNow()

  if (meetings.length === 0) {
    return (
      <div className="p-6">
        <p className="font-display text-display-sm">Nothing scheduled today.</p>
        <a
          href="/calendar"
          className="mt-4 inline-flex h-8 items-center rounded-sm bg-signal px-3 text-label font-semibold text-white transition-colors duration-[80ms] hover:bg-ink"
        >
          New meeting
        </a>
      </div>
    )
  }

  // Before mount there is no "now", so nothing is highlighted rather than
  // the wrong thing being highlighted.
  const reference = now ?? new Date(meetings[0]!.startsAt)
  const next =
    meetings.find((m) => meetingState(m, reference) === 'live') ??
    meetings.find((m) => new Date(m.startsAt).getTime() >= reference.getTime()) ??
    null

  return (
    <div className="p-6">
      {next && <NextUp meeting={next} zone={zone} now={now} />}

      <div className="mt-6">
        <h2 className="text-micro uppercase text-slate">
          {meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'} today
        </h2>
        <ul className="mt-2 divide-y divide-rule border-y border-rule">
          {meetings.map((m) => {
            const state = meetingState(m, reference)
            return (
              <li
                key={m.id}
                className="flex items-baseline gap-4 py-2.5"
                style={{ opacity: state === 'past' || state === 'cancelled' ? 0.45 : 1 }}
              >
                <span
                  className={`w-24 shrink-0 font-mono text-data tabular-nums ${
                    isTimeCritical(state) ? 'text-live' : 'text-slate'
                  }`}
                >
                  {formatRange(new Date(m.startsAt), new Date(m.endsAt), zone)}
                </span>
                <span className="min-w-0 flex-1">
                  {m.clientName && (
                    <span className="mr-2 text-micro uppercase text-slate">{m.clientName}</span>
                  )}
                  <span
                    className="text-body"
                    style={{
                      textDecoration: state === 'cancelled' ? 'line-through' : 'none',
                    }}
                  >
                    {m.title}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[0.6875rem] tracking-[-0.02em] text-slate">
                  {providerCode(m.conferencingProvider)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function NextUp({
  meeting,
  zone,
  now,
}: {
  meeting: MeetingDto
  zone: string
  now: Date | null
}) {
  const state = now ? meetingState(meeting, now) : 'upcoming'
  const critical = isTimeCritical(state)
  const hasLink = Boolean(meeting.conferenceUrl)

  return (
    <section
      className="rounded-sm border border-rule bg-surface p-6"
      style={{
        borderLeft: critical ? '2px solid var(--live)' : '2px solid var(--signal)',
      }}
    >
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-micro uppercase text-slate">
              {state === 'live' ? 'In progress' : 'Next'}
            </span>
            <span className="font-mono text-[0.6875rem] tracking-[-0.02em] text-slate">
              {providerCode(meeting.conferencingProvider)}
            </span>
          </div>

          {meeting.clientName && (
            <div className="mt-1 text-micro uppercase text-slate">{meeting.clientName}</div>
          )}

          <h2 className="mt-1 font-display text-display-sm">{meeting.title}</h2>

          <div className="mt-3 flex items-center gap-4">
            <span
              className={`font-mono text-data-lg tabular-nums ${critical ? 'text-live' : 'text-ink'}`}
            >
              {/* §8: "Starts in 12 minutes", never "Upcoming". */}
              {now ? relativeToNow(new Date(meeting.startsAt), now) : '—'}
            </span>
            <span className="h-4 w-px bg-rule" />
            <span className="font-mono text-data tabular-nums text-slate">
              {formatRange(new Date(meeting.startsAt), new Date(meeting.endsAt), zone)}
            </span>
          </div>

          <p className="mt-3 text-label text-slate">
            {meeting.attendees.map((a) => a.fullName).join(', ')}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {hasLink ? (
            <a
              href={meeting.conferenceUrl!}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center rounded-sm bg-signal px-6 text-body font-semibold text-white transition-colors duration-[80ms] hover:bg-ink"
            >
              Join {providerLabel(meeting.conferencingProvider)}
            </a>
          ) : meeting.clientPhone ? (
            <div>
              <div className="text-micro uppercase text-slate">Call the client</div>
              <div className="mt-1 font-mono text-data-lg tabular-nums">
                {meeting.clientPhone}
              </div>
            </div>
          ) : (
            <div className="text-micro uppercase text-slate">
              {formatTime(new Date(meeting.startsAt), zone)}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
