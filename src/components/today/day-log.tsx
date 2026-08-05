'use client'

import { providerCode, providerLabel } from '@/lib/meetings/schema'
import {
  durationMinutes,
  formatDuration,
  formatRange,
  formatTime,
  relativeToNow,
} from '@/lib/time'
import { useNow } from '@/components/shell/use-now'
import { blockStyle, isTimeCritical, meetingState } from '@/components/calendar/encoding'
import type { MeetingDto } from '@/components/calendar/types'

/**
 * Today (brief §6.1) — the most important screen in the product.
 *
 * The next meeting large above the fold, then the whole day as a run-of-show:
 * time, duration, who, where, and what you would do about it. The now-line
 * cuts into the list at the current time, so "what is behind me and what is
 * ahead" is a glance rather than a comparison.
 */

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-rule bg-paper font-semibold text-slate"
      style={{ width: size, height: size, fontSize: size <= 22 ? '0.5625rem' : '0.625rem' }}
    >
      {initialsOf(name)}
    </span>
  )
}

export function DayLog({
  meetings,
  zone,
  onOpen,
}: {
  meetings: MeetingDto[]
  zone: string
  onOpen?: (id: string) => void
}) {
  const now = useNow()

  if (meetings.length === 0) {
    return (
      <div className="min-w-[620px] max-w-[1440px] p-6">
        <p className="font-display text-display-sm">Nothing scheduled today.</p>
        <a
          href="/calendar?new=1"
          className="mt-4 inline-flex h-10 items-center rounded-sm btn-signal px-4 text-body font-semibold"
        >
          + New meeting
        </a>
      </div>
    )
  }

  const reference = now ?? new Date(meetings[0]!.startsAt)
  const live = meetings.filter((m) => m.status !== 'cancelled')

  const next =
    live.find((m) => meetingState(m, reference) === 'live') ??
    live.find((m) => new Date(m.startsAt).getTime() >= reference.getTime()) ??
    null

  const bookedMinutes = live.reduce(
    (sum, m) => sum + durationMinutes(new Date(m.startsAt), new Date(m.endsAt)),
    0,
  )

  // The now-line goes above the first meeting that has not started yet.
  const dividerBefore = now
    ? (meetings.find((m) => new Date(m.startsAt).getTime() > now.getTime())?.id ?? null)
    : null

  return (
    <div className="min-w-[620px] max-w-[1440px] p-6">
      {next && <NextUp meeting={next} zone={zone} now={now} onOpen={onOpen} />}

      <div className="mt-8 flex items-center justify-between border-b border-rule pb-2">
        <h2 className="text-micro uppercase text-slate">Run of day</h2>
        <span className="font-mono text-[0.6875rem] tracking-[-0.02em] tabular-nums text-slate">
          {live.length} {live.length === 1 ? 'meeting' : 'meetings'} ·{' '}
          {Math.round(bookedMinutes / 6) / 10}h booked
        </span>
      </div>

      <div className="border-b border-rule">
        {meetings.map((m) => {
          const state = meetingState(m, reference)
          const style = blockStyle(m, state)
          const start = new Date(m.startsAt)
          const end = new Date(m.endsAt)

          const action =
            m.status === 'cancelled'
              ? 'Cancelled'
              : state === 'past' || state === 'live'
                ? ''
                : m.conferenceUrl
                  ? 'Join'
                  : m.missingLink
                    ? 'No link'
                    : ''

          return (
            <div key={m.id}>
              {dividerBefore === m.id && now && (
                // The heartbeat, cutting into the list at the current time.
                <div className="flex items-center gap-2 py-2">
                  <span className="size-1 rounded-full bg-live" />
                  <span className="font-mono text-[0.6875rem] tracking-[-0.02em] tabular-nums text-live">
                    {formatTime(now, zone)}
                  </span>
                  <span className="h-px flex-1 bg-live" />
                </div>
              )}

              <button
                type="button"
                onClick={() => onOpen?.(m.id)}
                className="flex w-full items-center gap-4 border-t border-rule py-3 pl-2.5 pr-3 text-left transition-colors duration-[80ms] hover:bg-hover"
                style={{ borderLeft: style.borderLeft, opacity: style.opacity }}
              >
                <span
                  className="w-[108px] shrink-0 font-mono text-data leading-[1.2] tabular-nums"
                  style={{ color: isTimeCritical(state) ? 'var(--live)' : 'var(--slate)' }}
                >
                  {formatRange(start, end, zone)}
                </span>

                <span className="w-[52px] shrink-0 font-mono text-[0.6875rem] tracking-[-0.02em] text-slate">
                  {formatDuration(durationMinutes(start, end))}
                </span>

                <span className="min-w-0 flex-1">
                  {/* Fixed height so rows stay aligned whether or not there
                      is a client. The absence is the signal (§5), but it
                      must not shift the row. */}
                  <span className="block h-[15px] truncate text-micro uppercase leading-[15px] text-slate">
                    {m.clientName ?? ' '}
                  </span>
                  <span
                    className="block truncate text-body leading-[1.5]"
                    style={{ textDecoration: style.textDecoration }}
                  >
                    {m.title}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  {m.attendees.slice(0, 3).map((a) => (
                    <Avatar key={a.id} name={a.fullName} size={22} />
                  ))}
                </span>

                <span className="w-16 shrink-0 text-right font-mono text-[0.6875rem] tracking-[-0.02em] text-slate">
                  {providerCode(m.conferencingProvider)}
                </span>

                <span
                  className="w-[84px] shrink-0 text-right text-label font-medium"
                  style={{
                    color: action === 'Join' ? 'var(--signal)' : 'var(--slate)',
                  }}
                >
                  {action}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NextUp({
  meeting,
  zone,
  now,
  onOpen,
}: {
  meeting: MeetingDto
  zone: string
  now: Date | null
  onOpen?: (id: string) => void
}) {
  const state = now ? meetingState(meeting, now) : 'upcoming'
  const critical = isTimeCritical(state)

  return (
    <section
      className="rounded-sm border border-rule bg-surface p-6"
      style={{
        borderLeft: `2px solid ${critical ? 'var(--live)' : 'var(--signal)'}`,
        transition: 'border-color 400ms linear',
      }}
    >
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-micro uppercase text-slate">
              {state === 'live' ? 'In progress' : (meeting.clientName ?? 'Team meeting')}
            </span>
            <span className="font-mono text-[0.6875rem] tracking-[-0.02em] text-slate">
              {providerCode(meeting.conferencingProvider)}
            </span>
          </div>

          <h2 className="mt-2 font-display text-display-sm">{meeting.title}</h2>

          <div className="mt-3 flex items-center gap-4">
            <span
              className="font-mono text-data-lg tabular-nums"
              style={{
                color: critical ? 'var(--live)' : 'var(--ink)',
                transition: 'color 600ms linear',
              }}
            >
              {now ? relativeToNow(new Date(meeting.startsAt), now) : '—'}
            </span>
            <span className="h-4 w-px bg-rule" />
            <span className="font-mono text-data tabular-nums text-slate">
              {formatRange(new Date(meeting.startsAt), new Date(meeting.endsAt), zone)}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-2">
            {meeting.attendees.slice(0, 5).map((a) => (
              <Avatar key={a.id} name={a.fullName} size={24} />
            ))}
            <span className="ml-1 text-label text-slate">
              {meeting.attendees.length}{' '}
              {meeting.attendees.length === 1 ? 'person' : 'people'}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {meeting.conferenceUrl ? (
            <a
              href={meeting.conferenceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center rounded-sm btn-signal px-6 text-body font-semibold"
            >
              Join {providerLabel(meeting.conferencingProvider)}
            </a>
          ) : meeting.clientPhone ? (
            <div className="text-right">
              <div className="text-micro uppercase text-slate">Call the client</div>
              <div className="mt-1 font-mono text-data-lg tabular-nums">
                {meeting.clientPhone}
              </div>
            </div>
          ) : (
            <div className="text-right">
              <div className="text-micro uppercase text-slate">
                {meeting.missingLink ? 'No link yet' : 'No link'}
              </div>
            </div>
          )}

          <a
            href="/calendar?new=1"
            onClick={(e) => {
              if (!onOpen) return
              e.preventDefault()
              onOpen(meeting.id)
            }}
            className="inline-flex h-8 items-center rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal"
          >
            Details
          </a>
        </div>
      </div>
    </section>
  )
}
