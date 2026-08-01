'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { providerCode, providerLabel } from '@/lib/meetings/schema'
import { formatRange } from '@/lib/time'
import { NewMeetingModal } from './new-meeting-modal'
import { WeekGrid } from './week-grid'
import type { ClientDto, MeetingDto, PersonDto } from './types'

const CHIP =
  'flex h-7 items-center gap-1.5 rounded-sm border border-rule bg-surface px-2.5 text-label font-medium text-slate transition-colors duration-[80ms] hover:border-signal cursor-pointer'

const NAV_BUTTON =
  'flex size-7 items-center justify-center rounded-sm text-slate transition-colors duration-[80ms] hover:bg-rule cursor-pointer'

type TypeFilter = 'all' | 'internal' | 'client'
type PlatformFilter = 'all' | 'google_meet' | 'zoom' | 'whatsapp' | 'none'

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
  prevHref,
  nextHref,
  todayHref,
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
  prevHref: string
  nextHref: string
  todayHref: string
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [shortcuts, setShortcuts] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [search, setSearch] = useState('')

  /** Keyboard shortcuts: `n` new meeting, `t` today, `?` help, esc closes. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing =
        el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT'
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'n') {
        e.preventDefault()
        setModalOpen(true)
      } else if (e.key === 't') {
        window.location.href = todayHref
      } else if (e.key === '?') {
        setShortcuts(true)
      } else if (e.key === 'Escape') {
        setShortcuts(false)
        setSelected(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [todayHref])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const onCreated = useCallback((title: string, conflicts: { fullName: string }[]) => {
    // §8: the toast uses the button's verb. Conflicts are reported, not
    // apologised for — the meeting saved either way.
    setToast(
      conflicts.length > 0
        ? `Meeting created. ${conflicts.length === 1 ? `${conflicts[0]!.fullName} was` : `${conflicts.length} people were`} already busy.`
        : 'Meeting created',
    )
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return meetings.filter((m) => {
      if (typeFilter !== 'all' && m.type !== typeFilter) return false
      if (platform !== 'all' && m.conferencingProvider !== platform) return false
      if (mineOnly && !m.attendees.some((a) => a.id === meId)) return false
      if (q && !`${m.title} ${m.clientName ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [meetings, typeFilter, platform, mineOnly, search, meId])

  const hasFilters =
    typeFilter !== 'all' || platform !== 'all' || mineOnly || search.trim() !== ''

  function clearFilters() {
    setTypeFilter('all')
    setPlatform('all')
    setMineOnly(false)
    setSearch('')
  }

  const chosen = meetings.find((m) => m.id === selected) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Filter bar (§4.1.2) */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule bg-surface px-6 py-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className={CHIP}
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          <option value="internal">Team</option>
          <option value="client">Client</option>
        </select>

        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as PlatformFilter)}
          className={CHIP}
          aria-label="Filter by platform"
        >
          <option value="all">All platforms</option>
          <option value="google_meet">Google Meet</option>
          <option value="zoom">Zoom</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="none">No platform</option>
        </select>

        <button
          type="button"
          onClick={() => setMineOnly((v) => !v)}
          aria-pressed={mineOnly}
          className={CHIP}
          style={
            mineOnly
              ? {
                  borderColor: 'var(--signal)',
                  background: 'var(--fill-signal)',
                  color: 'var(--ink)',
                }
              : undefined
          }
        >
          Just me
        </button>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search meetings"
          className="h-7 w-[180px] rounded-sm border border-rule bg-surface px-2.5 text-label"
        />

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-7 cursor-pointer rounded-sm px-2 text-label font-medium text-signal"
          >
            Clear all
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <a href={prevHref} aria-label="Previous week" className={NAV_BUTTON}>
            ←
          </a>
          <span className="font-mono text-data tabular-nums text-slate">{weekLabel}</span>
          <a href={nextHref} aria-label="Next week" className={NAV_BUTTON}>
            →
          </a>
          <a
            href={todayHref}
            className="ml-1 flex h-7 cursor-pointer items-center rounded-sm border border-rule px-2.5 text-label font-medium text-slate transition-colors duration-[80ms] hover:border-signal"
          >
            Today
          </a>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="h-7 cursor-pointer rounded-sm bg-signal px-3 text-label font-semibold text-white transition-colors duration-[80ms] hover:bg-ink"
          >
            New meeting
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-16">
            {/* §8: says what is true, offers the next action, does not apologise. */}
            <p className="font-display text-display-sm">
              {hasFilters ? 'Nothing matches those filters.' : 'Nothing scheduled this week.'}
            </p>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="h-10 cursor-pointer rounded-sm border border-rule px-4 text-body font-medium transition-colors duration-[80ms] hover:border-signal"
              >
                Clear filters
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="h-10 cursor-pointer rounded-sm bg-signal px-4 text-body font-semibold text-white transition-colors duration-[80ms] hover:bg-ink"
              >
                + New meeting
              </button>
            )}
          </div>
        ) : (
          <WeekGrid
            meetings={filtered}
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
        onCreated={onCreated}
      />

      {shortcuts && <ShortcutSheet onClose={() => setShortcuts(false)} />}

      {toast && (
        <div className="animate-toast-in fixed bottom-16 right-6 z-50 min-w-[240px] overflow-hidden rounded-sm border border-rule bg-surface shadow-float">
          <div className="px-4 py-3 text-label font-medium">{toast}</div>
          <div className="animate-run-out h-px bg-signal" />
        </div>
      )}
    </div>
  )
}

const SHORTCUTS = [
  { what: 'New meeting', key: 'n' },
  { what: 'Jump to today', key: 't' },
  { what: 'Previous / next week', key: '← →' },
  { what: 'Close panel or dialog', key: 'esc' },
  { what: 'This list', key: '?' },
]

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="animate-veil-in fixed inset-0 z-40 flex items-center justify-center bg-veil p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-modal-in w-[420px] max-w-full rounded-sm border border-rule bg-surface p-6 shadow-float"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-title">Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-7 cursor-pointer rounded-sm text-slate transition-colors duration-[80ms] hover:bg-rule"
          >
            ×
          </button>
        </div>
        <div className="mt-4">
          {SHORTCUTS.map((s) => (
            <div
              key={s.what}
              className="flex items-center justify-between border-b border-rule py-2"
            >
              <span className="text-body">{s.what}</span>
              <span className="font-mono text-data tracking-[-0.02em] text-slate">{s.key}</span>
            </div>
          ))}
        </div>
      </div>
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
  const hasLink = Boolean(meeting.conferenceUrl)

  return (
    <aside className="animate-panel-in fixed inset-y-0 right-0 z-40 w-[480px] max-w-full overflow-auto border-l border-rule bg-surface shadow-float">
      <div className="flex h-12 items-center justify-between border-b border-rule pl-6 pr-4">
        <span className="text-micro uppercase text-slate">Meeting</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="size-7 cursor-pointer rounded-sm text-slate transition-colors duration-[80ms] hover:bg-rule"
        >
          ×
        </button>
      </div>

      <div className="p-6">
        {meeting.clientName && (
          <div className="text-micro uppercase text-slate">{meeting.clientName}</div>
        )}
        <h2 className="mt-1 font-display text-display-sm">{meeting.title}</h2>

        <div className="mt-2 flex items-center gap-3">
          <span className="font-mono text-data tabular-nums text-slate">
            {formatRange(new Date(meeting.startsAt), new Date(meeting.endsAt), zone)}
          </span>
          <span className="h-3 w-px bg-rule" />
          <span className="font-mono text-[0.6875rem] tracking-[-0.02em] text-slate">
            {providerCode(meeting.conferencingProvider)}
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
              Join {providerLabel(meeting.conferencingProvider)}
            </a>
          ) : (
            // The absence of a button must read as deliberate, not broken (§6.4).
            <div className="rounded-sm border border-rule bg-paper p-4">
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
                <span className="text-body">{a.fullName}</span>
                <span className="text-micro uppercase text-slate">{a.response}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  )
}
