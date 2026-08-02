'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  createMeetingAction,
  updateMeetingAction,
  type MeetingFormState,
} from '@/app/(app)/calendar/actions'
import { outcomeSummary, providerLabel } from '@/lib/meetings/schema'
import { overlaps, toWallClock } from '@/lib/time'
import type { ClientDto, MeetingDto, PersonDto } from './types'

type MeetingType = '' | 'internal' | 'client'
type Provider = 'google_meet' | 'zoom' | 'whatsapp' | 'none'

/** 44px controls, 2px radius, hairline border — the design's form geometry. */
const CONTROL =
  'h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'

const LABEL = 'mb-1 block text-label text-slate'
const HELP = 'mt-1 block text-label text-slate'

/** Fields build themselves in: 120ms fade + 4px rise, 40ms stagger (§7). */
function Field({
  index,
  label,
  help,
  children,
}: {
  index: number
  label: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="animate-rise-in"
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'backwards' }}
    >
      <span className={LABEL}>{label}</span>
      {children}
      {help && <span className={HELP}>{help}</span>}
    </div>
  )
}

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 cursor-pointer rounded-sm bg-signal px-4 text-body font-semibold text-white transition-colors duration-[80ms] hover:bg-ink disabled:opacity-60"
    >
      {/* §8: the toast reuses the button's verb, so they always agree. */}
      {pending
        ? editing
          ? 'Saving changes'
          : 'Creating meeting'
        : editing
          ? 'Save changes'
          : 'Create meeting'}
    </button>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

const TYPES = [
  { value: 'internal' as const, label: 'Team meeting', hint: 'Internal only' },
  { value: 'client' as const, label: 'Client meeting', hint: 'With a client on the call' },
]

export function NewMeetingModal({
  open,
  onClose,
  people,
  clients,
  meetings,
  meId,
  defaultDate,
  canInviteOthers,
  zone,
  editing,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  people: PersonDto[]
  clients: ClientDto[]
  meetings: MeetingDto[]
  meId: string
  defaultDate: string
  canInviteOthers: boolean
  zone: string
  /** §4.1.1: the same modal handles editing, prefilled. */
  editing?: MeetingDto | null
  onSaved: (verb: 'created' | 'updated', title: string, conflicts: { fullName: string }[]) => void
}) {
  const isEditing = Boolean(editing)

  const [state, formAction] = useActionState<MeetingFormState, FormData>(
    isEditing ? updateMeetingAction : createMeetingAction,
    {},
  )

  const startWall = editing ? toWallClock(new Date(editing.startsAt), zone) : null
  const endWall = editing ? toWallClock(new Date(editing.endsAt), zone) : null

  const [type, setType] = useState<MeetingType>(editing?.type ?? '')
  const [clientId, setClientId] = useState(editing?.clientId ?? '')
  const [provider, setProvider] = useState<Provider>(
    editing?.conferencingProvider ?? 'none',
  )
  const [date, setDate] = useState(
    startWall
      ? `${startWall.year}-${pad(startWall.month)}-${pad(startWall.day)}`
      : defaultDate,
  )
  const [start, setStart] = useState(
    startWall ? `${pad(startWall.hour)}:${pad(startWall.minute)}` : '09:30',
  )
  const [end, setEnd] = useState(
    endWall ? `${pad(endWall.hour)}:${pad(endWall.minute)}` : '10:00',
  )
  const [attendees, setAttendees] = useState<string[]>(
    editing ? editing.attendees.map((a) => a.id) : [meId],
  )
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    const title = state.created ?? state.updated
    if (!title) return
    onSaved(state.created ? 'created' : 'updated', title, state.conflicts ?? [])
    onClose()
  }, [state.created, state.updated, state.conflicts, onSaved, onClose])

  /** §4.2: domestic → Meet, international → Zoom. Preselect, always overridable. */
  useEffect(() => {
    if (type !== 'client' || !clientId) return
    const client = clients.find((c) => c.id === clientId)
    if (client) setProvider(client.region === 'international' ? 'zoom' : 'google_meet')
  }, [type, clientId, clients])

  useEffect(() => {
    if (type === 'client' && provider === 'none') setProvider('google_meet')
  }, [type, provider])

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
    setEnd(
      `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
    )
  }

  if (!open) return null

  const chosen = type !== ''

  return (
    <div
      className="animate-veil-in fixed inset-0 z-40 flex items-center justify-center bg-veil p-4"
      onMouseDown={(e) => {
        if (!dialog.current?.contains(e.target as Node)) onClose()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="New meeting"
        className="animate-modal-in max-h-[88vh] w-[560px] max-w-full overflow-auto rounded-sm border border-rule bg-surface shadow-float"
      >
        <div className="flex h-12 items-center justify-between border-b border-rule pl-6 pr-4">
          <h2 className="font-display text-title">
            {isEditing ? 'Edit meeting' : 'New meeting'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-7 cursor-pointer rounded-sm text-slate transition-colors duration-[80ms] hover:bg-rule"
          >
            ×
          </button>
        </div>

        <form action={formAction} className="p-6">
          {editing && <input type="hidden" name="id" value={editing.id} />}

          {/* Step 1 — nothing else renders until a type is chosen (§4.1.1). */}
          <div className="text-micro uppercase text-slate">Meeting type</div>
          <input type="hidden" name="type" value={type} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {TYPES.map((t) => {
              const active = type === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  aria-pressed={active}
                  className="cursor-pointer rounded-sm p-3 text-left transition-colors duration-[80ms]"
                  style={{
                    border: `1px solid ${active ? 'var(--signal)' : 'var(--rule)'}`,
                    borderLeft: `2px solid ${active ? 'var(--signal)' : 'var(--rule)'}`,
                    background: active ? 'var(--fill-signal)' : 'var(--surface)',
                  }}
                >
                  <div className="text-body font-medium">{t.label}</div>
                  <div className="mt-0.5 text-label text-slate">{t.hint}</div>
                </button>
              )
            })}
          </div>

          {chosen && (
            <>
              <div className="mt-6 flex flex-col gap-4">
                {type === 'client' && (
                  <Field
                    index={0}
                    label="Client"
                    help={
                      clients.length === 0
                        ? 'No clients yet. Client records arrive in Phase 4.'
                        : 'Sets the suggested platform. You can change it.'
                    }
                  >
                    <select
                      name="clientId"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      className={CONTROL}
                      required
                    >
                      <option value="">Choose a client</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.companyName}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field index={1} label="Platform">
                  <select
                    name="conferencingProvider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as Provider)}
                    className={CONTROL}
                  >
                    {providerOptions.map((p) => (
                      <option key={p} value={p}>
                        {providerLabel(p)}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Only where there is something to paste. WhatsApp and "no
                    platform" have no link by design (§4.3.1), and showing an
                    empty field for them would imply one is missing. */}
                {(provider === 'google_meet' || provider === 'zoom') && (
                  <Field
                    index={1}
                    label={`${providerLabel(provider)} link`}
                    help="Create the call yourself and paste the link. It goes to the team in chat, and to the client by email."
                  >
                    <input
                      name="conferenceUrl"
                      type="url"
                      required
                      defaultValue={editing?.conferenceUrl ?? ''}
                      placeholder={
                        provider === 'zoom'
                          ? 'https://zoom.us/j/…'
                          : 'https://meet.google.com/…'
                      }
                      className={CONTROL}
                    />
                  </Field>
                )}

                <Field index={2} label="Title">
                  <input
                    name="title"
                    required
                    maxLength={200}
                    defaultValue={editing?.title ?? ''}
                    className={CONTROL}
                  />
                </Field>

                <div
                  className="animate-rise-in"
                  style={{ animationDelay: '120ms', animationFillMode: 'backwards' }}
                >
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className={LABEL}>Date</span>
                      <input
                        name="date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                        className={CONTROL}
                      />
                    </div>
                    <div>
                      <span className={LABEL}>Start</span>
                      <input
                        name="start"
                        type="time"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        required
                        className={`${CONTROL} font-mono tabular-nums`}
                      />
                    </div>
                    <div>
                      <span className={LABEL}>End</span>
                      <input
                        name="end"
                        type="time"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                        required
                        className={`${CONTROL} font-mono tabular-nums`}
                      />
                    </div>
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
                    <span className="self-center text-label text-slate">or set a custom end</span>
                  </div>
                </div>

                <div
                  className="animate-rise-in"
                  style={{ animationDelay: '160ms', animationFillMode: 'backwards' }}
                >
                  <span className={LABEL}>Attendees</span>
                  <div className="max-h-44 overflow-auto rounded-sm border border-rule">
                    {people.map((p) => {
                      const checked = attendees.includes(p.id)
                      const busy = conflicts.has(p.id)
                      const locked = !canInviteOthers && p.id !== meId
                      return (
                        <label
                          key={p.id}
                          className="flex h-9 items-center justify-between gap-2 border-b border-rule px-3 last:border-b-0"
                        >
                          <span className="flex min-w-0 items-center gap-2">
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
                            <span className="truncate text-label">
                              {p.fullName}
                              {p.id === meId && <span className="text-slate"> (you)</span>}
                            </span>
                          </span>
                          {checked && busy && (
                            // Warns, never blocks (§4.1).
                            <span className="shrink-0 text-micro uppercase text-live">
                              Already busy
                            </span>
                          )}
                          {locked && (
                            <span className="shrink-0 text-micro uppercase text-slate">
                              Needs permission
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>

                <Field index={5} label="Description (optional)">
                  <textarea
                    name="description"
                    rows={2}
                    defaultValue={editing?.description ?? ''}
                    className="w-full rounded-sm border border-rule bg-surface px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2"
                  />
                </Field>
              </div>

              {/* Step 4 — say exactly what will happen, then the actions. */}
              <div className="mt-6 flex items-center justify-between gap-4 border-t border-rule pt-4">
                <p className="text-label font-medium">
                  {/* §4.1.1 step 4: name the recipients, not the mechanism.
                      The likeliest surprise now is that the client gets an
                      email at all. */}
                  {outcomeSummary(
                    provider,
                    Math.max(0, attendees.length - 1),
                    type === 'client'
                      ? (clients.find((c) => c.id === clientId)?.companyName ?? 'the client')
                      : null,
                  )}
                </p>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-11 cursor-pointer rounded-sm border border-rule bg-surface px-4 text-body font-medium transition-colors duration-[80ms] hover:border-signal"
                  >
                    Cancel
                  </button>
                  <Submit editing={isEditing} />
                </div>
              </div>
            </>
          )}

          {state.error && (
            <p role="alert" className="mt-4 text-label text-slate">
              {state.error}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
