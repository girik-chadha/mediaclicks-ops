'use client'

import { openAssistant } from '@/components/assistant/assistant-panel'
import { providerCode, providerLabel } from '@/lib/meetings/schema'
import { formatRange, formatTime, relativeToNow } from '@/lib/time'
import { isTimeCritical, meetingState } from '@/components/calendar/encoding'
import type { MeetingDto } from '@/components/calendar/types'
import { useNow } from '@/components/shell/use-now'

export interface ActivityDto {
  id: string
  initials: string
  who: string
  when: string
  what: string
  where: string
}

export interface ClientWeekDto {
  id: string
  name: string
  region: string
  count: number
}

const SECTION_HEAD =
  'flex items-baseline justify-between border-b border-rule pb-2'
const SECTION_TITLE = 'text-micro uppercase text-slate'
const MONO_META = 'font-mono text-[0.6875rem] tracking-[-0.02em] tabular-nums text-slate'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

function partOfDay(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function HomeScreen({
  meetings,
  activity,
  clientsWeek,
  zone,
  firstName,
  meId,
}: {
  meetings: MeetingDto[]
  activity: ActivityDto[]
  clientsWeek: ClientWeekDto[]
  zone: string
  firstName: string
  meId: string
}) {
  const now = useNow()
  const reference = now ?? new Date()

  const live = meetings.filter((m) => m.status !== 'cancelled')
  const remaining = live.filter((m) => new Date(m.endsAt).getTime() > reference.getTime())
  const done = live.length - remaining.length
  const next = remaining[0] ?? null

  const bookedMinutes = remaining.reduce(
    (sum, m) => sum + (new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60000,
    0,
  )

  const nextState = next ? meetingState(next, reference) : null
  const urgent = nextState ? isTimeCritical(nextState) : false

  /**
   * "Needs you" — derived from the data, never invented. The design's demo
   * items come from chat and approvals that do not exist yet; these are the
   * two the schema can answer truthfully today.
   */
  const noLink = remaining.filter(
    (m) => m.conferencingProvider === 'whatsapp' || m.conferencingProvider === 'none',
  )
  const awaitingReply = live.filter((m) =>
    m.attendees.some((a) => a.response === 'pending' && a.id !== meId),
  )

  const needs = [
    noLink.length > 0 && {
      kind: 'No link',
      what: `${noLink[0]!.title} has no link. You'll need to call.`,
      meta: `${formatTime(new Date(noLink[0]!.startsAt), zone)} · ${providerCode(noLink[0]!.conferencingProvider)}`,
      border: '2px dashed var(--slate)',
    },
    awaitingReply.length > 0 && {
      kind: 'No reply',
      what:
        awaitingReply.length === 1
          ? `Someone hasn't answered ${awaitingReply[0]!.title}.`
          : `${awaitingReply.length} meetings are still waiting on replies.`,
      meta: `${awaitingReply.reduce((n, m) => n + m.attendees.filter((a) => a.response === 'pending').length, 0)} people`,
      border: '2px solid var(--live)',
    },
  ].filter(Boolean) as { kind: string; what: string; meta: string; border: string }[]

  const dateline = now
    ? `${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: zone }).format(now)} · ${formatTime(now, zone)}`
    : ''

  return (
    <div className="min-w-[660px] max-w-[1280px] px-6 pb-12 pt-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-8 border-b border-rule pb-6">
        <div className="min-w-0">
          <div className={SECTION_TITLE}>{dateline || ' '}</div>
          <h1 className="mt-3 font-display text-display-lg">
            {now ? `${partOfDay(Number(formatTime(now, zone).slice(0, 2)))}, ${firstName}.` : `Hello, ${firstName}.`}
          </h1>
          <p className="mt-2 max-w-[60ch] text-body text-slate text-pretty">
            {live.length === 0
              ? 'Nothing scheduled today.'
              : remaining.length === 0
                ? `Everything on today's list is done — ${done} ${done === 1 ? 'meeting' : 'meetings'} behind you.`
                : `You have ${remaining.length} meeting${remaining.length === 1 ? '' : 's'} left today and ${done} already behind you.`}
          </p>
        </div>

        <div className="flex shrink-0 gap-8 pb-1">
          <Stat value={String(remaining.length)} label="Left today" />
          <Stat value={`${Math.round(bookedMinutes / 6) / 10}h`} label="Time booked" />
          <Stat
            value={next ? formatTime(new Date(next.startsAt), zone) : '—'}
            label="Next start"
            live={urgent}
          />
        </div>
      </div>

      {/* Up next */}
      {next && (
        <section className="mt-8">
          <div className={SECTION_HEAD}>
            <h2 className={SECTION_TITLE}>Up next</h2>
            <span className={MONO_META}>{providerCode(next.conferencingProvider)}</span>
          </div>
          <div
            className="mt-4 rounded-sm border border-rule bg-surface p-6"
            style={{
              borderLeft: `2px solid ${urgent ? 'var(--live)' : 'var(--signal)'}`,
              transition: 'border-color 400ms linear',
            }}
          >
            <div className="flex items-start justify-between gap-8">
              <div className="min-w-0">
                <div className={SECTION_TITLE}>
                  {nextState === 'live' ? 'In progress' : (next.clientName ?? 'Team meeting')}
                </div>
                <div className="mt-2 font-display text-display-sm">{next.title}</div>
                <div className="mt-3 flex items-center gap-4">
                  <span
                    className="font-mono text-data-lg tabular-nums"
                    style={{
                      color: urgent ? 'var(--live)' : 'var(--ink)',
                      transition: 'color 600ms linear',
                    }}
                  >
                    {now ? relativeToNow(new Date(next.startsAt), now) : '—'}
                  </span>
                  <span className="h-4 w-px bg-rule" />
                  <span className="font-mono text-data tabular-nums text-slate">
                    {formatRange(new Date(next.startsAt), new Date(next.endsAt), zone)}
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  {next.attendees.slice(0, 5).map((a) => (
                    <Avatar key={a.id} name={a.fullName} size={24} />
                  ))}
                  <span className="ml-1 text-label text-slate">
                    {next.attendees.length} {next.attendees.length === 1 ? 'person' : 'people'}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                {next.conferenceUrl ? (
                  <a
                    href={next.conferenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center rounded-sm btn-signal px-6 text-body font-semibold"
                  >
                    Join {providerLabel(next.conferencingProvider)}
                  </a>
                ) : (
                  <div className="text-right">
                    <div className={SECTION_TITLE}>
                      {next.clientPhone ? 'Call the client' : 'No link'}
                    </div>
                    <div className="mt-1 font-mono text-data-lg tabular-nums">
                      {next.clientPhone ?? 'Reminders only'}
                    </div>
                  </div>
                )}
                <a
                  href="/today"
                  className="inline-flex h-8 items-center rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal"
                >
                  Details
                </a>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Needs you */}
      {needs.length > 0 && (
        <section className="mt-10">
          <div className={SECTION_HEAD}>
            <h2 className={SECTION_TITLE}>Needs you</h2>
            <span className={MONO_META}>
              {needs.length} {needs.length === 1 ? 'item' : 'items'}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {needs.map((n) => (
              <div
                key={n.kind}
                className="rounded-sm border border-rule bg-surface p-4"
                style={{ borderLeft: n.border }}
              >
                <div className={SECTION_TITLE}>{n.kind}</div>
                <p className="mt-2 text-body leading-[1.4] text-pretty">{n.what}</p>
                <div className={`mt-3 ${MONO_META}`}>{n.meta}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* The rest of your day */}
      <section className="mt-10">
        <div className={SECTION_HEAD}>
          <h2 className={SECTION_TITLE}>The rest of your day</h2>
          <a href="/today" className="text-label font-medium text-signal">
            Full run of day
          </a>
        </div>

        {remaining.length === 0 ? (
          <p className="py-6 text-body text-slate">Nothing else today.</p>
        ) : (
          remaining.map((m) => {
            const state = meetingState(m, reference)
            return (
              <div
                key={m.id}
                className="flex items-center gap-4 border-b border-rule py-3 pl-2.5 pr-3"
                style={{
                  borderLeft: `2px ${m.conferenceUrl || m.conferencingProvider === 'google_meet' || m.conferencingProvider === 'zoom' ? 'solid var(--signal)' : 'dashed var(--slate)'}`,
                }}
              >
                <span
                  className="w-[108px] shrink-0 font-mono text-data tabular-nums"
                  style={{ color: isTimeCritical(state) ? 'var(--live)' : 'var(--slate)' }}
                >
                  {formatRange(new Date(m.startsAt), new Date(m.endsAt), zone)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block h-[15px] truncate text-micro uppercase leading-[15px] text-slate">
                    {m.clientName ?? ' '}
                  </span>
                  <span className="block truncate text-body">{m.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {m.attendees.slice(0, 3).map((a) => (
                    <Avatar key={a.id} name={a.fullName} size={22} />
                  ))}
                </span>
                <span className={`w-16 shrink-0 text-right ${MONO_META}`}>
                  {providerCode(m.conferencingProvider)}
                </span>
              </div>
            )
          })
        )}
      </section>

      {/* Activity + clients */}
      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section>
          <div className={SECTION_HEAD}>
            <h2 className={SECTION_TITLE}>Since you were last here</h2>
          </div>
          {activity.length === 0 ? (
            <p className="py-6 text-body text-slate">Nothing has changed yet.</p>
          ) : (
            activity.map((a) => (
              <div key={a.id} className="flex gap-3 border-b border-rule py-3">
                <span className="shrink-0">
                  <Avatar name={a.who} size={28} initials={a.initials} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-body font-semibold">{a.who}</span>
                    <span className={MONO_META}>{formatTime(new Date(a.when), zone)}</span>
                  </div>
                  <p className="text-body leading-[1.5] text-pretty">{a.what}</p>
                </div>
                <span className="shrink-0 pt-1 font-mono text-[0.5625rem] tracking-[-0.02em] text-slate">
                  {a.where}
                </span>
              </div>
            ))
          )}
        </section>

        <section>
          <h2 className={`${SECTION_TITLE} border-b border-rule pb-2`}>Clients this week</h2>
          {clientsWeek.length === 0 ? (
            <p className="py-6 text-body text-slate">
              No clients yet. Client records arrive in Phase 4.
            </p>
          ) : (
            clientsWeek.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-rule py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body leading-[1.4]">{c.name}</div>
                  <div className="text-label text-slate">{c.region}</div>
                </div>
                <span className={MONO_META}>{c.count} this wk</span>
              </div>
            ))
          )}

          <div className="mt-4 rounded-sm border border-rule border-l-2 border-l-signal p-3">
            <div className="text-micro uppercase text-signal">Assistant</div>
            <p className="mt-1.5 text-body">
              Ask it to move, cancel, or find time. It shows you exactly what it will do
              before anything is sent.
            </p>
            <button
              type="button"
              onClick={openAssistant}
              className="mt-3 h-8 cursor-pointer rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal"
            >
              Open assistant
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({ value, label, live }: { value: string; label: string; live?: boolean }) {
  return (
    <div>
      <div
        className="font-mono text-data-lg tabular-nums"
        style={{ color: live ? 'var(--live)' : 'var(--ink)' }}
      >
        {value}
      </div>
      <div className="mt-1.5 text-micro uppercase text-slate">{label}</div>
    </div>
  )
}

function Avatar({
  name,
  size,
  initials,
}: {
  name: string
  size: number
  initials?: string
}) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full border border-rule bg-paper font-semibold text-slate"
      style={{ width: size, height: size, fontSize: size <= 22 ? '0.5625rem' : '0.625rem' }}
      title={name}
    >
      {initials ?? initialsOf(name)}
    </span>
  )
}
