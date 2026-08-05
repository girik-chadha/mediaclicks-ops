'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { openAssistant } from '@/components/assistant/assistant-panel'

const SHORTCUTS = [
  { what: 'New meeting', key: 'n' },
  { what: 'Jump to today', key: 't' },
  { what: 'Search everything', key: '⌘K' },
  { what: 'Ask the assistant', key: 'a' },
  { what: 'Previous / next week', key: '← →' },
  { what: 'Close panel or dialog', key: 'esc' },
  { what: 'This list', key: '?' },
]

/**
 * The right-hand side of the page header, per the design.
 *
 * The shortcuts sheet lives here rather than inside the calendar because `?`
 * should answer the same question on every screen. Keeping it in one place
 * also means the list cannot drift from screen to screen.
 */
export function HeaderActions() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  // The calendar has its own New meeting button in its toolbar, beside the
  // week controls. Two of them on one screen is a question about whether
  // they do different things, and they do not.
  const onCalendar = pathname === '/calendar'

  /**
   * Everywhere else the button used to be a plain link to /calendar, which
   * navigated and then sat there — the person clicked "New meeting" and got
   * a calendar. It now carries the intent across in the URL, and the
   * calendar opens the same modal it opens for its own button.
   */
  const newMeeting = useCallback(() => {
    router.push('/calendar?new=1')
  }, [router])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing =
        el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT'
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') setOpen(true)
      else if (e.key === 'a') openAssistant()
      else if (e.key === 'n' && !onCalendar) newMeeting()
      else if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCalendar, newMeeting])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Keyboard shortcuts"
        className="size-7 cursor-pointer rounded-sm text-label text-slate transition-colors duration-[80ms] hover:bg-rule"
      >
        ?
      </button>

      <button
        type="button"
        onClick={openAssistant}
        className="h-8 cursor-pointer rounded-sm border border-rule bg-surface px-3 text-label font-medium transition-colors duration-[80ms] hover:border-signal"
      >
        Assistant
      </button>

      {!onCalendar && (
        <button
          type="button"
          onClick={newMeeting}
          className="flex h-8 items-center rounded-sm btn-signal px-3 text-label font-semibold"
        >
          New meeting
        </button>
      )}

      {open && (
        <div
          className="animate-veil-in fixed inset-0 z-50 flex items-center justify-center bg-veil p-4"
          onMouseDown={() => setOpen(false)}
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
                onClick={() => setOpen(false)}
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
                  <span className="font-mono text-data tracking-[-0.02em] text-slate">
                    {s.key}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
