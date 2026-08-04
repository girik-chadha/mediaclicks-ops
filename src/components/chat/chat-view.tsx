'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createChannelAction,
  decideApprovalAction,
  joinChannelAction,
  markReadAction,
  openDirectMessageAction,
  sendMessageAction,
} from '@/app/(app)/chat/actions'
import { formatTime } from '@/lib/time'

export interface ConversationDto {
  id: string
  kind: 'channel' | 'direct'
  label: string
  unread: number
  online: boolean
}

export interface ApprovalDto {
  id: string
  status: string
  summary: string
  canDecide: boolean
}

export interface MessageDto {
  id: string
  authorUserId: string | null
  authorName: string
  body: string
  createdAt: string
  mine: boolean
  approval?: ApprovalDto
}

export interface PersonDto {
  id: string
  fullName: string
  online: boolean
}

/** Consecutive messages from one person inside this window share a header. */
const GROUP_WINDOW_MS = 5 * 60_000

/** How often the open conversation is refetched. See the note in the composer. */
const POLL_MS = 8000

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

interface Group {
  key: string
  authorName: string
  at: Date
  mine: boolean
  lines: string[]
  /** An approval never joins a run — it is a thing to act on, not a line
   *  of chat, and burying it in someone's paragraph loses it. */
  approval?: ApprovalDto
}

/**
 * Groups a run of messages from the same person.
 *
 * The design shows one avatar and timestamp per run, not per message. Without
 * this, a person sending three short lines produces three avatars and the
 * column stops reading as a conversation.
 */
function group(messages: MessageDto[]): Group[] {
  const groups: Group[] = []

  for (const m of messages) {
    const at = new Date(m.createdAt)
    const last = groups.at(-1)
    const sameAuthor = last && last.authorName === m.authorName
    const closeInTime = last && at.getTime() - last.at.getTime() < GROUP_WINDOW_MS

    if (sameAuthor && closeInTime && !m.approval && !last.approval) last.lines.push(m.body)
    else
      groups.push({
        key: m.id,
        authorName: m.authorName,
        at,
        mine: m.mine,
        lines: [m.body],
        ...(m.approval ? { approval: m.approval } : {}),
      })
  }

  return groups
}

export function ChatView({
  conversations,
  joinable,
  people,
  activeId,
  messages,
  zone,
}: {
  conversations: ConversationDto[]
  joinable: { id: string; name: string | null }[]
  people: PersonDto[]
  activeId: string | null
  messages: MessageDto[]
  zone: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPeople, setShowPeople] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const active = conversations.find((c) => c.id === activeId) ?? null
  const channels = conversations.filter((c) => c.kind === 'channel')
  const directs = conversations.filter((c) => c.kind === 'direct')
  const groups = useMemo(() => group(messages), [messages])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, activeId])

  /** Opening a conversation marks it read. */
  useEffect(() => {
    if (!activeId) return
    void markReadAction(activeId)
  }, [activeId, messages.length])

  /**
   * Polling, not websockets.
   *
   * Supabase Realtime would be the eventual answer, but it is a second
   * transport, a second auth path and a second failure mode. At 5–25 people
   * an eight-second poll of one conversation is a rounding error, and it
   * cannot get stuck in a state a refresh does not fix. Worth revisiting when
   * someone complains, not before.
   */
  useEffect(() => {
    if (!activeId) return
    const timer = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [activeId, router])

  function send() {
    const body = draft.trim()
    if (!body || !activeId) return
    setDraft('')
    setError(null)
    startTransition(async () => {
      const result = await sendMessageAction(activeId, body)
      if (result.error) {
        setError(result.error)
        setDraft(body) // Give it back rather than losing what they wrote.
      } else {
        router.refresh()
      }
    })
  }

  function openConversation(id: string) {
    router.push(`/chat?c=${id}`)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <div className="hidden w-52 shrink-0 flex-col overflow-auto border-r border-rule bg-surface px-2 py-3 md:flex">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-micro uppercase text-slate">Channels</span>
          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Channel name')
              if (!name) return
              startTransition(async () => {
                const result = await createChannelAction(name)
                if (result.error) setError(result.error)
                else if (result.id) openConversation(result.id)
              })
            }}
            aria-label="New channel"
            className="cursor-pointer text-label text-slate hover:text-signal"
          >
            +
          </button>
        </div>

        {channels.map((c) => (
          <Row
            key={c.id}
            label={`#${c.label}`}
            unread={c.unread}
            active={c.id === activeId}
            onClick={() => openConversation(c.id)}
          />
        ))}

        {joinable.length > 0 && (
          <details className="mt-1 px-2">
            <summary className="cursor-pointer text-label text-slate">
              {joinable.length} more
            </summary>
            <div className="mt-1 flex flex-col gap-0.5">
              {joinable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await joinChannelAction(c.id)
                      openConversation(c.id)
                    })
                  }
                  className="cursor-pointer rounded-sm px-1 py-1 text-left text-label text-slate hover:bg-hover"
                >
                  #{c.name} <span className="text-slate">· join</span>
                </button>
              ))}
            </div>
          </details>
        )}

        <div className="flex items-center justify-between px-2 pb-2 pt-4">
          <span className="text-micro uppercase text-slate">Direct</span>
          <button
            type="button"
            onClick={() => setShowPeople((v) => !v)}
            aria-label="New direct message"
            className="cursor-pointer text-label text-slate hover:text-signal"
          >
            +
          </button>
        </div>

        {showPeople && (
          <div className="animate-rise-in mb-2 rounded-sm border border-rule p-1">
            {people.length === 0 ? (
              <p className="px-1 py-1 text-label text-slate">Nobody else yet.</p>
            ) : (
              people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await openDirectMessageAction(p.id)
                      setShowPeople(false)
                      if (result.error) setError(result.error)
                      else if (result.id) openConversation(result.id)
                    })
                  }
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left text-label hover:bg-hover"
                >
                  <Avatar name={p.fullName} online={p.online} size={20} />
                  <span className="truncate">{p.fullName}</span>
                </button>
              ))
            )}
          </div>
        )}

        {directs.map((c) => (
          <Row
            key={c.id}
            label={c.label}
            unread={c.unread}
            active={c.id === activeId}
            avatar={<Avatar name={c.label} online={c.online} size={20} />}
            onClick={() => openConversation(c.id)}
          />
        ))}
      </div>

      {/* Conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="font-display text-display-sm">Nothing open.</p>
            <p className="text-body text-slate">
              Pick a channel or start a direct message.
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rule px-6">
              <span className="text-body font-semibold">
                {active.kind === 'channel' ? `#${active.label}` : active.label}
              </span>
              <span className="text-label text-slate">
                {active.kind === 'direct'
                  ? active.online
                    ? 'Online'
                    : 'Offline'
                  : 'Everyone who has joined'}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
              {groups.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <p className="font-display text-display-sm">No messages yet.</p>
                  <p className="text-body text-slate">Start the conversation.</p>
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.key} className="flex gap-3 py-2">
                    <div className="w-7 shrink-0">
                      <Avatar name={g.authorName} online={false} size={28} hideDot />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-body font-semibold">{g.authorName}</span>
                        <span className="font-mono text-[0.6875rem] tracking-[-0.02em] tabular-nums text-slate">
                          {formatTime(g.at, zone)}
                        </span>
                      </div>
                      {g.lines.map((line, i) => (
                        <p
                          key={i}
                          className="whitespace-pre-wrap text-body leading-[1.5] text-pretty"
                        >
                          {line}
                        </p>
                      ))}
                      {g.approval && <ApprovalCard approval={g.approval} />}
                    </div>
                  </div>
                ))
              )}
              <div ref={bottom} />
            </div>

            <div className="shrink-0 border-t border-rule px-6 py-3">
              <textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder={`Message ${active.kind === 'channel' ? `#${active.label}` : active.label}`}
                className="w-full resize-none rounded-sm border border-rule bg-surface px-3 py-2.5 text-body leading-[1.5] focus-visible:outline-2 focus-visible:outline-signal focus-visible:outline-offset-2"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-micro uppercase text-slate">
                  Enter sends · Shift + Enter for a new line
                </span>
                {pending && <span className="text-label text-slate">Sending</span>}
                {error && (
                  <span role="alert" className="text-label text-slate">
                    {error}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({
  label,
  unread,
  active,
  avatar,
  onClick,
}: {
  label: string
  unread: number
  active: boolean
  avatar?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left transition-colors duration-[80ms] hover:bg-hover"
      style={{
        height: avatar ? 32 : 30,
        background: active ? 'var(--hover)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--slate)',
        fontWeight: active || unread > 0 ? 600 : 400,
      }}
    >
      {avatar}
      <span className="min-w-0 flex-1 truncate text-label">{label}</span>
      {unread > 0 && (
        // Unread is attention, not time-criticality, so it is --signal.
        // Magenta is reserved (§3).
        <span className="font-mono text-[0.6875rem] tracking-[-0.02em] text-signal">
          {unread}
        </span>
      )}
    </button>
  )
}

function Avatar({
  name,
  online,
  size,
  hideDot,
}: {
  name: string
  online: boolean
  size: number
  hideDot?: boolean
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className="flex items-center justify-center rounded-full border border-rule bg-paper font-semibold text-slate"
        style={{ width: size, height: size, fontSize: size <= 20 ? '0.5rem' : '0.625rem' }}
      >
        {initialsOf(name)}
      </span>
      {!hideDot && (
        <span
          className="absolute -bottom-px -right-px size-1.5 rounded-full border border-surface"
          style={{ background: online ? 'var(--signal)' : 'var(--rule)' }}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  )
}


/**
 * An approval request, inside the conversation it arrived in (ADR 0008).
 *
 * Only the person being asked sees buttons — `canDecide` is computed on the
 * server, and `decideApprovalAction` checks it again rather than trusting
 * that this component rendered honestly. Everyone else, including the
 * person who asked, sees the same card showing where it stands, so the
 * requester can tell "not answered yet" from "turned down".
 */
function ApprovalCard({ approval }: { approval: ApprovalDto }) {
  const [state, setState] = useState(approval.status)
  const [error, setError] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()

  function decide(decision: 'approved' | 'denied') {
    setError(null)
    startTransition(async () => {
      const result = await decideApprovalAction(approval.id, decision)
      if (result.ok) setState(decision)
      else setError(result.message)
    })
  }

  const settled = state !== 'pending'

  return (
    <div className="mt-2 max-w-[420px] rounded-sm border border-rule border-l-2 border-l-signal p-3">
      <div className="text-micro uppercase text-signal">Needs your approval</div>
      <p className="mt-1.5 text-body">{approval.summary}</p>

      {settled ? (
        <p className="mt-2 text-label text-slate">
          {state === 'approved' ? 'You approved this.' : 'You turned this down.'}
        </p>
      ) : approval.canDecide ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => decide('approved')}
            disabled={busy}
            className="h-8 cursor-pointer rounded-sm btn-signal px-3 text-label font-semibold disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => decide('denied')}
            disabled={busy}
            className="h-8 cursor-pointer rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      ) : (
        <p className="mt-2 text-label text-slate">Waiting on them.</p>
      )}

      {error && <p className="mt-2 text-label text-live">{error}</p>}
    </div>
  )
}
