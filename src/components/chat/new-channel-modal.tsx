'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createChannelAction } from '@/app/(app)/chat/actions'
import { normaliseChannelName } from '@/lib/chat/keys'
import type { PersonDto } from './chat-view'

/** The form geometry every other dialog uses: 44px controls, 2px radius. */
const CONTROL =
  'h-11 w-full rounded-sm border border-rule bg-surface px-3 text-body focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2'
const LABEL = 'mb-1 block text-label text-slate'
const HELP = 'mt-1 block text-label text-slate'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/**
 * Create a channel and choose who is in it.
 *
 * Replaces a `window.prompt('Channel name')`. Three things that could not
 * say: whether the room is private, who should be in it, and — when the
 * name is taken or the person may not do this — why it did not work.
 *
 * The creator is always a member and is not shown in the list; a channel
 * you cannot see is not one you created. The name preview shows the
 * normalised form ("Creative Review" → #creative-review) as it is typed, so
 * the thing that gets created is the thing that was seen.
 */
export function NewChannelModal({
  open,
  onClose,
  people,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  people: PersonDto[]
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [members, setMembers] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const nameInput = useRef<HTMLInputElement>(null)

  const slug = useMemo(() => normaliseChannelName(name), [name])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? people.filter((p) => p.fullName.toLowerCase().includes(q)) : people
  }, [people, filter])

  // Reset on every open, and put the cursor where the typing starts.
  useEffect(() => {
    if (!open) return
    setName('')
    setIsPrivate(false)
    setMembers(new Set())
    setFilter('')
    setError(null)
    const t = setTimeout(() => nameInput.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const toggle = (id: string) =>
    setMembers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectAll = () => setMembers(new Set(people.map((p) => p.id)))
  const selectNone = () => setMembers(new Set())

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!slug) {
      setError('Give the channel a name.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await createChannelAction({
        name,
        isPrivate,
        memberIds: [...members],
      })
      if (result.error) setError(result.error)
      else if (result.id) onCreated(result.id)
    })
  }

  return (
    <div
      className="animate-veil-in fixed inset-0 z-40 flex items-center justify-center bg-veil p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-channel-title"
        // Timing comes from the utility, not from here — globals.css owns
        // every duration so a dialog cannot invent its own (brief §7).
        className="animate-modal-in w-full max-w-[440px] rounded-sm border border-rule bg-surface p-6"
        style={{ boxShadow: 'var(--float)' }}
      >
        <div className="flex items-baseline justify-between">
          <h2 id="new-channel-title" className="font-display text-display-sm">
            New channel
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer text-label text-slate hover:text-ink"
          >
            Esc
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <label className="block">
            <span className={LABEL}>Name</span>
            <input
              ref={nameInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="creative"
              className={CONTROL}
            />
            <span className={HELP}>
              {slug ? (
                <>
                  Will be <span className="text-ink">#{slug}</span>
                </>
              ) : (
                'Lower-case, dashes for spaces.'
              )}
            </span>
          </label>

          <label className="flex cursor-pointer select-none items-start gap-2.5">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={`mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-[2px] border text-[0.625rem] font-semibold text-white transition-colors duration-[80ms] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal ${
                isPrivate ? 'border-signal bg-signal' : 'border-rule bg-surface'
              }`}
            >
              {isPrivate ? '✓' : ''}
            </span>
            <span className="min-w-0">
              <span className="block text-label text-ink">Private</span>
              <span className="block text-label text-slate">
                Only the people chosen below can see it. Otherwise anyone on the team can join.
              </span>
            </span>
          </label>

          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-label text-slate">
                People
                {members.size > 0 && (
                  <span className="text-ink"> · {members.size} chosen</span>
                )}
              </span>
              <span className="flex gap-3 text-label">
                <button type="button" onClick={selectAll} className="cursor-pointer text-signal">
                  Everyone
                </button>
                <button type="button" onClick={selectNone} className="cursor-pointer text-slate">
                  None
                </button>
              </span>
            </div>

            {people.length > 6 && (
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find someone"
                aria-label="Filter people"
                className={`${CONTROL} mb-2 h-9`}
              />
            )}

            <div className="max-h-56 overflow-auto rounded-sm border border-rule">
              {shown.length === 0 ? (
                <p className="px-3 py-2 text-label text-slate">
                  {people.length === 0 ? 'Nobody else on the team yet.' : 'No one matches.'}
                </p>
              ) : (
                shown.map((p) => {
                  const on = members.has(p.id)
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-rule px-3 py-2 last:border-b-0 hover:bg-hover"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(p.id)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={`flex size-[16px] flex-none items-center justify-center rounded-[2px] border text-[0.5625rem] font-semibold text-white transition-colors duration-[80ms] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal ${
                          on ? 'border-signal bg-signal' : 'border-rule bg-surface'
                        }`}
                      >
                        {on ? '✓' : ''}
                      </span>
                      <span className="flex size-5 flex-none items-center justify-center rounded-full bg-invert text-[0.5625rem] font-semibold text-invert-fg">
                        {initialsOf(p.fullName)}
                      </span>
                      <span className="truncate text-label text-ink">{p.fullName}</span>
                      {p.online && (
                        <span className="ml-auto size-1.5 rounded-full bg-signal" aria-label="Online" />
                      )}
                    </label>
                  )
                })
              )}
            </div>
            <span className={HELP}>You are in it either way.</span>
          </div>

          {error && (
            <p role="alert" aria-live="polite" className="text-label text-slate">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 cursor-pointer rounded-sm border border-rule bg-surface px-4 text-body font-medium transition-colors duration-[80ms] hover:border-signal"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !slug}
              className="h-11 cursor-pointer rounded-sm btn-signal px-4 text-body font-semibold disabled:opacity-60"
            >
              {pending ? 'Creating' : 'Create channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
