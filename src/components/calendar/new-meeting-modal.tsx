'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createMeetingAction, type MeetingFormState } from '@/app/(app)/calendar/actions'
import { outcomeSummary, providerLabel } from '@/lib/meetings/schema'
import { overlaps } from '@/lib/time'
import type { ClientDto, MeetingDto, PersonDto } from './types'

type MeetingType = '' | 'internal' | 'client'

/** Fields appear with a 120ms fade-and-rise, staggered 40ms (§7). */
function Reveal({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div
      className="animate-rise-in"
      style={{ animationDelay: `${step * 40}ms`, animationFillMode: 'backwards' }}
    >
      {children}
    </div>
  )
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 cursor-pointer rounded-sm bg-signal px-4 text-label font-semibold text-white transition-colors duration-[80ms] hover:bg-ink disabled:opacity-60"
    >
      {/* §8: the toast uses the button's verb. */}
      {pending ? 'Creating meeting' : label}
    </button>
  )
}

const field =
  'h-9 w-full rounded-sm border border-rule bg-surface px-2 text-body focus-visible:outline-2 focus-visible:outline-signal'

export function NewMeetingModal({
  open,
  onClose,
  people,
  clients,
  meetings,
  meId,
  defaultDate,
  canInviteOthers,
}: {
  open: boolean
  onClose: () => void
  people: PersonDto[]
  clients: ClientDto[]
  meetings: MeetingDto[]
  meId: string
  defaultDate: string
  canInviteOthers: boolean
}) {
  const [state, formAction] = useActionState<MeetingFormState, FormData>(
    createMeetingAction,
    {},
  )

  const [type, setType] = useState<MeetingType>('')
  const [clientId, setClientId] = useState('')
  const [provider, setProvider] = useState('none')
  const [date, setDate] = useState(defaultDate)
  const [start, setStart] = useState('09:30')
  const [end, setEnd] = useState('10:00')
  const [attendees, setAttendees] = useState<string[]>([meId])
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Close once the server confirms, so the calendar behind is already fresh.
  useEffect(() => {
    if (state.created) onClose()
  }, [state.created, onClose])

  /** §4.2: domestic → Meet, international → Zoom. A preselect, always overridable. */
  useEffect(() => {
    if (type !== 'client' || !clientId) return
    const client = clients.find((c) => c.id === clientId)
    if (client) setProvider(client.region === 'international' ? 'zoom' : 'google_meet')
  }, [type, clientId, clients])

  const providerOptions =
    type === 'client'
      ? (['google_meet', 'zoom', 'whatsapp'] as const)
      : (['google_meet', 'zoom', 'whatsapp', 'none'] as const)

  /** Live conflict indicator (§4.1.1 step 3). Warns, never blocks. */
  const conflicts = useMemo(() => {
    if (!date || !start || !end) return new Set<string>()
    const s = new Date(`${date}T${start}`)
    const e = new Date(`${date}T${end}`)
    const busy = new Set<string>()
    for (const m of meetings) {
      if (m.status === 'cancelled') continue
      if (!overlaps(new Date(m.startsAt), new Date(m.endsAt), s, e)) continue
      for (const a of m.attendees) if (attendees.includes(a.id)) busy.add(a.id)
    }
    return busy
  }, [date, start, end, attendees, meetings])

  function setDuration(minutes: number) {
    const [h, m] = start.split(':').map(Number)
    const total = h! * 60 + m! + minutes
    setEnd(`${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`)
  }

  if (!open) return null

  return (
    <div
      className="animate-veil-in fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-veil p-6"
      onMouseDown={(e) => {
        if (!dialog.current?.contains(e.target as Node)) onClose()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="New meeting"
        className="animate-modal-in mt-12 w-full max-w-[560px] rounded-sm border border-rule bg-surface shadow-float"
      >
        <div className="flex h-12 items-center justify-between border-b border-rule px-4">
          <h2 className="font-display text-title">New meeting</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-7 cursor-pointer rounded-sm text-slate transition-colors duration-[80ms] hover:bg-hover"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-4 p-4">
          {/* Step 1 — nothing else renders until this is chosen (§4.1.1). */}
          <label className="block">
            <span className="mb-1 block text-label text-slate">Meeting type</span>
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as MeetingType)}
              className={field}
              required
            >
              <option value="">Choose one</option>
              <option value="internal">Team meeting</option>
              <option value="client">Client meeting</option>
            </select>
          </label>

          {type === 'client' && (
            <Reveal step={0}>
              <label className="block">
                <span className="mb-1 block text-label text-slate">Client</span>
                <select
                  name="clientId"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className={field}
                  required
                >
                  <option value="">Choose a client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName}
                    </option>
                  ))}
                </select>
                {clients.length === 0 && (
                  <span className="mt-1 block text-label text-slate">
                    No clients yet. Client records arrive in Phase 4.
                  </span>
                )}
              </label>
            </Reveal>
          )}

          {type && (
            <>
              <Reveal step={1}>
                <label className="block">
                  <span className="mb-1 block text-label text-slate">Platform</span>
                  <select
                    name="conferencingProvider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className={field}
                  >
                    {providerOptions.map((p) => (
                      <option key={p} value={p}>
                        {providerLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
              </Reveal>

              <Reveal step={2}>
                <label className="block">
                  <span className="mb-1 block text-label text-slate">Title</span>
                  <input name="title" required maxLength={200} className={field} />
                </label>
              </Reveal>

              <Reveal step={3}>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-label text-slate">Date</span>
                    <input
                      name="date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      required
                      className={field}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-label text-slate">Start</span>
                    <input
                      name="start"
                      type="time"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      required
                      className={field}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-label text-slate">End</span>
                    <input
                      name="end"
                      type="time"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                      required
                      className={field}
                    />
                  </label>
                </div>
                <div className="mt-2 flex gap-2">
                  {[30, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDuration(m)}
                      className="h-7 cursor-pointer rounded-sm border border-rule px-2 text-label text-slate transition-colors duration-[80ms] hover:border-signal"
                    >
                      {m === 60 ? '1h' : `${m}m`}
                    </button>
                  ))}
                </div>
              </Reveal>

              <Reveal step={4}>
                <fieldset>
                  <legend className="mb-1 text-label text-slate">Attendees</legend>
                  <div className="max-h-40 overflow-auto rounded-sm border border-rule">
                    {people.map((p) => {
                      const checked = attendees.includes(p.id)
                      const busy = conflicts.has(p.id)
                      const locked = !canInviteOthers && p.id !== meId
                      return (
                        <label
                          key={p.id}
                          className="flex items-center justify-between gap-2 border-b border-rule px-2 py-1.5 last:border-b-0"
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              name="attendeeIds"
                              value={p.id}
                              checked={checked}
                              disabled={locked}
                              onChange={(e) =>
                                setAttendees((prev) =>
                                  e.target.checked
                                    ? [...prev, p.id]
                                    : prev.filter((id) => id !== p.id),
                                )
                              }
                            />
                            <span className="text-label">{p.fullName}</span>
                          </span>
                          {/* Warns, does not block (§4.1). */}
                          {checked && busy && (
                            <span className="text-micro uppercase text-live">Busy</span>
                          )}
                          {locked && (
                            <span className="text-micro uppercase text-slate">
                              Needs permission
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              </Reveal>

              <Reveal step={5}>
                <label className="block">
                  <span className="mb-1 block text-label text-slate">
                    Description <span className="text-slate">(optional)</span>
                  </span>
                  <textarea name="description" rows={2} className={`${field} h-auto py-1.5`} />
                </label>
              </Reveal>

              {/* Step 4 — say exactly what will happen (§4.1.1). This kills
                  the likeliest error: expecting a link and not getting one. */}
              <Reveal step={6}>
                <div className="flex items-center justify-between gap-4 border-t border-rule pt-4">
                  <p className="text-label text-slate">
                    {outcomeSummary(
                      provider as 'google_meet' | 'zoom' | 'whatsapp' | 'none',
                      attendees.length,
                    )}
                  </p>
                  <Submit label="Create meeting" />
                </div>
              </Reveal>
            </>
          )}

          {state.error && (
            <p role="alert" className="text-label text-slate">
              {state.error}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
