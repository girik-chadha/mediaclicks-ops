'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  createClientAction,
  updateClientAction,
  type ClientFormState,
} from '@/app/(app)/clients/actions'
import { providerCode } from '@/lib/meetings/schema'

export interface ClientDetail {
  id: string
  companyName: string
  contactName: string | null
  email: string | null
  phoneE164: string | null
  region: 'domestic' | 'international'
  preferredChannel: 'email' | 'whatsapp'
  notes: string | null
  meetingCount: number
  history: {
    id: string
    title: string
    startsAt: string
    status: string
    conferencingProvider: 'google_meet' | 'zoom' | 'whatsapp' | 'none'
  }[]
}

const CONTROL =
  'h-9 w-full rounded-sm border border-rule bg-surface px-2 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'
const MICRO = 'text-micro uppercase text-slate'
const MONO = 'font-mono text-[0.6875rem] tracking-[-0.02em] tabular-nums text-slate'

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 cursor-pointer rounded-sm btn-signal px-3 text-label font-semibold disabled:opacity-60"
    >
      {pending ? busy : idle}
    </button>
  )
}

/** Shown at the top of a form, where a refused save cannot be scrolled past. */
function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mb-3 rounded-sm border border-live px-3 py-2 text-label font-medium text-live"
      style={{ borderLeftWidth: 2 }}
    >
      {message}
    </p>
  )
}

/**
 * Editing a client in place.
 *
 * Its own component, and keyed on the client id by the caller, so the
 * prefilled values are rebuilt when a different client is selected. Sharing
 * one form across selections meant `defaultValue` — which only applies on
 * mount — kept showing whoever was picked first.
 */
function EditClient({
  client,
  onDone,
}: {
  client: ClientDetail
  onDone: () => void
}) {
  const [state, formAction] = useActionState<ClientFormState, FormData>(
    updateClientAction,
    {},
  )

  useEffect(() => {
    if (state.updated) onDone()
  }, [state.updated, onDone])

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="id" value={client.id} />
      {state.error && <FormError message={state.error} />}

      <div className="flex flex-col gap-3">
        <Labelled label="Company">
          <input
            name="companyName"
            required
            maxLength={200}
            defaultValue={client.companyName}
            className={CONTROL}
          />
        </Labelled>
        <Labelled label="Contact">
          <input
            name="contactName"
            maxLength={200}
            defaultValue={client.contactName ?? ''}
            className={CONTROL}
          />
        </Labelled>
        <Labelled label="Email">
          {/* type="text", not "email". The browser's own validation blocks
              submission with a tooltip that says nothing useful, and the
              server checks the shape anyway — where the message can be
              written in the product's voice. */}
          <input
            name="email"
            type="text"
            inputMode="email"
            maxLength={320}
            defaultValue={client.email ?? ''}
            className={CONTROL}
          />
        </Labelled>
        <Labelled label="Phone">
          <input
            name="phoneE164"
            maxLength={32}
            placeholder="+971 50 000 0000"
            defaultValue={client.phoneE164 ?? ''}
            className={`${CONTROL} font-mono tabular-nums`}
          />
        </Labelled>
        <Labelled label="Region">
          <select name="region" defaultValue={client.region} className={CONTROL}>
            <option value="domestic">Domestic</option>
            <option value="international">International</option>
          </select>
        </Labelled>
        <Labelled label="Channel">
          <select
            name="preferredChannel"
            defaultValue={client.preferredChannel}
            className={CONTROL}
          >
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </Labelled>
        <Labelled label="Notes">
          <textarea
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={client.notes ?? ''}
            className={`${CONTROL} h-auto py-1.5`}
          />
        </Labelled>
      </div>

      <div className="mt-4 flex gap-2">
        <Submit idle="Save changes" busy="Saving" />
        <button
          type="button"
          onClick={onDone}
          className="h-9 cursor-pointer rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-label text-slate">
        Emptying a field clears it. Changing the name updates it everywhere,
        including on past meetings.
      </p>
    </form>
  )
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro uppercase text-slate">{label}</span>
      {children}
    </label>
  )
}

export function ClientsView({
  clients,
  canManage,
  zone,
}: {
  clients: ClientDetail[]
  canManage: boolean
  zone: string
}) {
  const [selectedId, setSelectedId] = useState<string | null>(clients[0]?.id ?? null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [state, formAction] = useActionState<ClientFormState, FormData>(
    createClientAction,
    {},
  )

  const selected = clients.find((c) => c.id === selectedId) ?? null

  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: zone,
  })

  return (
    <div className="flex h-full min-w-[980px]">
      {/* List */}
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between border-b border-rule pb-2">
          <span className={MICRO}>All clients</span>
          <div className="flex items-center gap-3">
            <span className={MONO}>
              {clients.length} {clients.length === 1 ? 'client' : 'clients'}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="h-7 cursor-pointer rounded-sm border border-rule px-2.5 text-label font-medium text-slate transition-colors duration-[80ms] hover:border-signal"
              >
                {adding ? 'Cancel' : '+ New client'}
              </button>
            )}
          </div>
        </div>

        {adding && canManage && (
          <form
            action={formAction}
            className="animate-rise-in mt-4 rounded-sm border border-rule bg-surface p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-label text-slate">Company</span>
                <input name="companyName" required className={CONTROL} />
              </label>
              <label className="block">
                <span className="mb-1 block text-label text-slate">Contact</span>
                <input name="contactName" className={CONTROL} />
              </label>
              <label className="block">
                <span className="mb-1 block text-label text-slate">Email</span>
                <input name="email" type="email" className={CONTROL} />
              </label>
              <label className="block">
                <span className="mb-1 block text-label text-slate">Phone</span>
                <input
                  name="phoneE164"
                  placeholder="+971 50 000 0000"
                  className={`${CONTROL} font-mono tabular-nums`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-label text-slate">Region</span>
                <select name="region" className={CONTROL} defaultValue="domestic">
                  <option value="domestic">Domestic</option>
                  <option value="international">International</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-label text-slate">Preferred channel</span>
                <select name="preferredChannel" className={CONTROL} defaultValue="email">
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Submit idle="Add client" busy="Adding client" />
              <span className="text-label text-slate">
                Region sets the suggested platform. It is never a rule.
              </span>
            </div>
            {state.error && (
              <div className="mt-3">
                <FormError message={state.error} />
              </div>
            )}
          </form>
        )}

        {clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <p className="font-display text-display-sm">No clients yet.</p>
            <p className="max-w-[420px] text-body text-slate">
              Adding one lets you book client meetings and sets whether Meet or Zoom is
              suggested.
            </p>
          </div>
        ) : (
          clients.map((c) => {
            const active = c.id === selectedId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelectedId(c.id)
                  // Picking someone else abandons a half-typed edit rather
                  // than carrying it onto a different client's record.
                  setEditing(false)
                }}
                className="flex w-full items-center gap-4 border-b border-rule p-3 text-left transition-colors duration-[80ms] hover:bg-hover"
                style={{ background: active ? 'var(--hover)' : 'transparent' }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium leading-[1.5]">
                    {c.companyName}
                  </span>
                  <span className="block truncate text-label text-slate">
                    {c.contactName ?? c.email ?? '—'}
                  </span>
                </span>
                <span className="w-[120px] shrink-0 whitespace-nowrap text-label text-slate">
                  {c.region === 'international' ? 'International' : 'Domestic'}
                </span>
                <span className="w-[132px] shrink-0 font-mono text-label tracking-[-0.02em] tabular-nums text-slate">
                  {c.phoneE164 ?? '—'}
                </span>
                <span className={`w-24 shrink-0 text-right ${MONO}`}>
                  {c.meetingCount} {c.meetingCount === 1 ? 'mtg' : 'mtgs'}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <aside className="w-[400px] shrink-0 overflow-auto border-l border-rule bg-surface p-6">
          <div className="flex items-center justify-between">
            <div className={MICRO}>Client</div>
            {canManage && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="h-7 cursor-pointer rounded-sm border border-rule px-2.5 text-label font-medium text-slate transition-colors duration-[80ms] hover:border-signal"
              >
                Edit
              </button>
            )}
          </div>
          <h2 className="mt-2 font-display text-display-sm">{selected.companyName}</h2>

          {editing && canManage ? (
            <EditClient
              // Rebuilds the prefilled fields when the selection changes.
              key={selected.id}
              client={selected}
              onDone={() => setEditing(false)}
            />
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <Field label="Contact" value={selected.contactName ?? '—'} />
              <Field label="Email" value={selected.email ?? '—'} />
              <Field label="Phone" value={selected.phoneE164 ?? '—'} mono />
              <Field
                label="Region"
                value={selected.region === 'international' ? 'International' : 'Domestic'}
              />
              <Field
                label="Channel"
                value={selected.preferredChannel === 'whatsapp' ? 'WhatsApp' : 'Email'}
              />
              {/* Loaded and stored all along, but never shown until now. */}
              {selected.notes && <Field label="Notes" value={selected.notes} />}
            </div>
          )}

          {/* §4.2: a preselect, never a gate. The copy says so out loud. */}
          <div
            className="mt-4 rounded-sm border border-rule p-3"
            style={{ borderLeft: '2px solid var(--signal)' }}
          >
            <div className="text-micro uppercase text-signal">Region rule</div>
            <p className="mt-1.5 text-body leading-[1.5]">
              {selected.region === 'international'
                ? 'International client, so Zoom is suggested. You can always change it.'
                : 'Domestic client, so Google Meet is suggested. You can always change it.'}
            </p>
            <a
              href="/calendar"
              className="mt-3 inline-flex h-8 items-center rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal"
            >
              New meeting with {selected.companyName.split(' ')[0]}
            </a>
          </div>

          <div className={`mt-6 border-b border-rule pb-2 ${MICRO}`}>Meeting history</div>
          {selected.history.length === 0 ? (
            <p className="py-4 text-body text-slate">No meetings with this client yet.</p>
          ) : (
            selected.history.map((h) => {
              const hasLink =
                h.conferencingProvider === 'google_meet' || h.conferencingProvider === 'zoom'
              return (
                <div
                  key={h.id}
                  className="flex gap-3 border-b border-rule py-2 pl-2"
                  style={{
                    borderLeft: hasLink
                      ? '2px solid var(--signal)'
                      : '2px dashed var(--slate)',
                  }}
                >
                  <span className={`w-[92px] shrink-0 ${MONO}`}>
                    {dateFmt.format(new Date(h.startsAt))}
                  </span>
                  <span
                    className="min-w-0 flex-1 text-label leading-[1.4]"
                    style={{
                      textDecoration: h.status === 'cancelled' ? 'line-through' : 'none',
                      opacity: h.status === 'cancelled' ? 0.4 : 1,
                    }}
                  >
                    {h.title}
                  </span>
                  <span className="font-mono text-[0.5625rem] tracking-[-0.02em] text-slate">
                    {providerCode(h.conferencingProvider)}
                  </span>
                </div>
              )
            })
          )}
        </aside>
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 border-b border-rule py-1.5">
      <span className="w-24 shrink-0 pt-0.5 text-micro uppercase text-slate">{label}</span>
      <span
        className={`min-w-0 flex-1 text-body leading-[1.4] ${mono ? 'font-mono tabular-nums tracking-[-0.02em]' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}
