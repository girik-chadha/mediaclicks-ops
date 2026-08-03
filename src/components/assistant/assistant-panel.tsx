'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  askAssistant,
  confirmAssistant,
  type PlanLine,
} from '@/app/(app)/assistant-actions'
import { EXAMPLES } from '@/lib/assistant/parse'
import type { PerformedAction } from '@/lib/assistant/plan'

/**
 * The assistant panel (§4.6, design §6.4).
 *
 * Four states, exactly as the design draws them: idle with suggestions,
 * busy with a shimmer skeleton, ready with a "Will do" card the person must
 * confirm, and done. Answers with nothing to confirm reuse the ready layout
 * without a card, because a reply belongs where the reply would have been.
 *
 * The Confirm button is the only thing in this feature that has an effect.
 * Everything above it is a proposal.
 */

/** Anything on any screen can open the panel. */
export const OPEN_ASSISTANT = 'assistant:open'

export function openAssistant() {
  window.dispatchEvent(new Event(OPEN_ASSISTANT))
}

/**
 * `answered` covers both "here is your answer, there is nothing to confirm"
 * and "I couldn't do that". They render identically because they are the
 * same thing to the reader: a reply, and no card.
 */
type Phase = 'idle' | 'busy' | 'ready' | 'done' | 'answered'

/**
 * Taken from the grammar rather than written here, so the panel cannot
 * advertise a phrasing the parser has stopped understanding.
 */
const SUGGESTIONS = EXAMPLES.slice(0, 3)

export function AssistantPanel() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [plan, setPlan] = useState<PlanLine[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [done, setDone] = useState<PerformedAction[]>([])
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onOpen() {
      setOpen(true)
      // The panel exists to be typed into; landing in it saves a click on
      // every single use.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener(OPEN_ASSISTANT, onOpen)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_ASSISTANT, onOpen)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pending) return

    setPrompt(trimmed)
    setPhase('busy')
    setPlan([])
    setToken(null)
    setDone([])

    startTransition(async () => {
      const result = await askAssistant(trimmed)
      if (!result.ok) {
        setAnswer(result.error)
        setPhase('answered')
        return
      }
      setAnswer(result.answer)
      setPlan(result.plan)
      setToken(result.token)
      // A question with no changes to make is finished, not awaiting
      // confirmation — showing a Confirm button for nothing is a lie about
      // what the button does.
      setPhase(result.token ? 'ready' : 'answered')
    })
  }

  function confirm() {
    if (!token || pending) return
    startTransition(async () => {
      const result = await confirmAssistant(token)
      if (!result.ok) {
        setAnswer(result.error)
        setPhase('answered')
        return
      }
      setDone(result.done)
      setPhase('done')
    })
  }

  function reset() {
    setPhase('idle')
    setPrompt('')
    setAnswer('')
    setPlan([])
    setToken(null)
    setDone([])
    inputRef.current?.focus()
  }

  if (!open) return null

  return (
    <aside
      aria-label="Assistant"
      className="animate-panel-in fixed inset-y-0 right-0 z-40 flex w-[480px] max-w-full flex-col border-l border-rule bg-surface shadow-float"
    >
      <div className="flex h-12 items-center justify-between border-b border-rule pl-6 pr-4">
        <span className="text-micro uppercase text-slate">Assistant</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="size-7 cursor-pointer rounded-sm text-slate transition-colors duration-[80ms] hover:bg-rule"
        >
          ×
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {phase === 'idle' && (
          <>
            <p className="text-body text-slate">
              Ask for a change to the schedule. Nothing happens until you confirm it.
            </p>
            <div className="mt-2 text-micro uppercase text-slate">Try</div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="cursor-pointer rounded-sm border border-rule bg-surface px-3 py-2.5 text-left text-body transition-colors duration-[80ms] hover:border-signal"
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        {phase !== 'idle' && <Said prompt={prompt} />}

        {phase === 'busy' && (
          <div className="flex flex-col gap-2">
            <div className="text-micro uppercase text-slate">Assistant</div>
            <div className="animate-shimmer h-3 w-[70%] rounded-sm bg-rule" />
            <div className="animate-shimmer h-3 w-[45%] rounded-sm bg-rule [animation-delay:120ms]" />
            <div className="animate-shimmer h-[88px] w-full rounded-sm bg-rule [animation-delay:240ms]" />
          </div>
        )}

        {(phase === 'ready' || phase === 'answered') && (
          <div className="flex flex-col gap-1">
            <div className="text-micro uppercase text-slate">Assistant</div>
            {/* pre-line: answers carry lists — a day's meetings, the free
                slots, the meetings that matched an ambiguous title. */}
            <p className="whitespace-pre-line text-body">{answer}</p>
          </div>
        )}

        {phase === 'ready' && (
          <>
            <div className="rounded-sm border border-signal border-l-2 border-l-signal p-4">
              <div className="text-micro uppercase text-signal">Will do</div>
              <Lines lines={plan} className="mt-3" />
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={pending}
                  className="h-9 cursor-pointer rounded-sm btn-signal px-4 text-label font-semibold disabled:opacity-50"
                >
                  {pending ? 'Working…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={pending}
                  className="h-9 cursor-pointer rounded-sm border border-rule bg-surface px-4 text-label font-medium transition-colors duration-[80ms] hover:border-signal disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
            <p className="text-label text-slate">Nothing is sent until you confirm.</p>
          </>
        )}

        {phase === 'answered' && (
          <button
            type="button"
            onClick={reset}
            className="h-8 w-fit cursor-pointer rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal"
          >
            Ask for something else
          </button>
        )}

        {phase === 'done' && (
          <div className="rounded-sm border border-rule border-l-2 border-l-signal p-4">
            <div className="text-micro uppercase text-slate">Done</div>
            <Lines
              className="mt-3"
              lines={done.map((d) => ({
                verb: d.verb,
                // A row that failed says so in place. A "Done" card listing
                // something that did not happen is the worst possible
                // outcome of a confirmation flow.
                what: d.ok ? d.what : `${d.what} — didn't go through`,
              }))}
            />
            <button
              type="button"
              onClick={reset}
              className="mt-4 h-8 cursor-pointer rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal"
            >
              Ask for something else
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-rule px-6 py-3">
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask for a change"
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const el = e.currentTarget
            ask(el.value)
            el.value = ''
          }}
          className="h-9 w-full rounded-sm border border-rule bg-surface px-3 text-body disabled:opacity-50"
        />
      </div>
    </aside>
  )
}

function Said({ prompt }: { prompt: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-micro uppercase text-slate">You</div>
      <div className="max-w-[320px] rounded-sm border border-rule px-3 py-2.5 text-body">
        {prompt}
      </div>
    </div>
  )
}

function Lines({ lines, className }: { lines: PlanLine[]; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {lines.map((l, i) => (
        <div key={`${l.verb}-${i}`} className="flex gap-3">
          <div className="w-24 flex-none font-mono text-data text-slate">{l.verb}</div>
          <div className="min-w-0 flex-1 text-body">{l.what}</div>
        </div>
      ))}
    </div>
  )
}
