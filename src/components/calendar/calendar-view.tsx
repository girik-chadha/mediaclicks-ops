'use client'

import { useEffect, useState } from 'react'
import { formatRange, providerLabelSafe } from './helpers'
import { NewMeetingModal } from './new-meeting-modal'
import { WeekGrid } from './week-grid'
import type { ClientDto, MeetingDto, PersonDto } from './types'

export function CalendarView({
  meetings,
  people,
  clients,
  weekStartIso,
  zone,
  meId,
  defaultDate,
  canInviteOthers,
  weekLabel,
  onPrev,
  onNext,
}: {
  meetings: MeetingDto[]
  people: PersonDto[]
  clients: ClientDto[]
  weekStartIso: string
  zone: string
  meId: string
  defaultDate: string
  canInviteOthers: boolean
  weekLabel: string
  onPrev: string
  onNext: string
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  /** Keyboard shortcuts (§5 of the spec, brief §6): `n` new meeting. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing =
        el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT'
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'n') {
        e.preventDefault()
        setModalOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const chosen = meetings.find((m) => m.id === selected) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-rule bg-surface px-6 py-2">
        <div className="flex items-center gap-2">
          <a
            href={onPrev}
            aria-label="Previous week"
            className="flex size-7 items-center justify-center rounded-sm border border-rule text-slate transition-colors duration-[80ms] hover:border-signal"
          >
            ‹
          </a>
          <a
            href={onNext}
            aria-label="Next week"
            className="flex size-7 items-center justify-center rounded-sm border border-rule text-slate transition-colors duration-[80ms] hover:border-signal"
          >
            ›
          </a>
          <span className="ml-2 font-mono text-data tabular-nums text-slate">{weekLabel}</span>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="h-8 cursor-pointer rounded-sm bg-signal px-3 text-label font-semibold text-white transition-colors duration-[80ms] hover:bg-ink"
        >
          New meeting
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {meetings.length === 0 ? (
          <div className="p-8">
            {/* §8: empty states say what is true and offer the next action. */}
            <p className="font-display text-display-sm">Nothing scheduled this week.</p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="mt-4 h-8 cursor-pointer rounded-sm bg-signal px-3 text-label font-semibold text-white transition-colors duration-[80ms] hover:bg-ink"
            >
              New meeting
            </button>
          </div>
        ) : (
          <WeekGrid
            meetings={meetings}
            weekStartIso={weekStartIso}
            zone={zone}
            onOpen={setSelected}
          />
        )}
      </div>

      {chosen && (
        <DetailPanel meeting={chosen} zone={zone} onClose={() => setSelected(null)} />
      )}

      <NewMeetingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        people={people}
        clients={clients}
        meetings={meetings}
        meId={meId}
        defaultDate={defaultDate}
        canInviteOthers={canInviteOthers}
      />
    </div>
  )
}

/** Slides in from the right, 480px (brief §6.4). */
function DetailPanel({
  meeting,
  zone,
  onClose,
}: {
  meeting: MeetingDto
  zone: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasLink = Boolean(meeting.conferenceUrl)

  return (
    <aside className="animate-panel-in fixed inset-y-0 right-0 z-40 w-[480px] max-w-full overflow-auto border-l border-rule bg-surface shadow-float">
      <div className="flex h-12 items-center justify-between border-b border-rule px-4">
        <span className="text-micro uppercase text-slate">Meeting</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="size-7 cursor-pointer rounded-sm text-slate transition-colors duration-[80ms] hover:bg-hover"
        >
          ✕
        </button>
      </div>

      <div className="p-6">
        {meeting.clientName && (
          <div className="text-micro uppercase text-slate">{meeting.clientName}</div>
        )}
        <h2 className="mt-1 font-display text-display-sm">{meeting.title}</h2>
        <div className="mt-2 font-mono text-data tabular-nums text-slate">
          {formatRange(new Date(meeting.startsAt), new Date(meeting.endsAt), zone)}
          <span className="ml-2 text-micro uppercase">
            {providerLabelSafe(meeting.conferencingProvider)}
          </span>
        </div>

        <div className="mt-6">
          {hasLink ? (
            <a
              href={meeting.conferenceUrl!}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center rounded-sm bg-signal px-6 text-body font-semibold text-white transition-colors duration-[80ms] hover:bg-ink"
            >
              Join
            </a>
          ) : (
            // The absence of a button must read as deliberate, not broken (§6.4).
            <div>
              <div className="text-micro uppercase text-slate">
                {meeting.clientPhone ? 'Call the client' : 'No link'}
              </div>
              <div className="mt-1 font-mono text-data-lg tabular-nums">
                {meeting.clientPhone ?? 'Reminders only'}
              </div>
            </div>
          )}
        </div>

        {meeting.description && (
          <p className="mt-6 max-w-prose text-body text-slate">{meeting.description}</p>
        )}

        <div className="mt-6">
          <div className="text-micro uppercase text-slate">
            {meeting.attendees.length}{' '}
            {meeting.attendees.length === 1 ? 'attendee' : 'attendees'}
          </div>
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {meeting.attendees.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span className="text-label">{a.fullName}</span>
                <span className="text-micro uppercase text-slate">{a.response}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  )
}
