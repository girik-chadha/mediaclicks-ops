'use client'

import { useEffect, useRef, useState } from 'react'

export interface AvatarMenuProps {
  fullName: string
  roleLabel: string
  onSignOut: () => Promise<void>
}

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function AvatarMenu({ fullName, roleLabel, onSignOut }: AvatarMenuProps) {
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark')
  }, [])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setOpen(false)
  }

  return (
    <div ref={container} className="relative border-t border-rule p-3">
      {open && (
        <div className="animate-rise-in absolute inset-x-3 bottom-[60px] z-30 rounded-sm border border-rule bg-surface p-1 shadow-float">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-[30px] w-full cursor-pointer items-center rounded-sm px-2 text-left text-label transition-colors duration-[80ms] hover:bg-hover"
          >
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="flex h-[30px] w-full cursor-pointer items-center rounded-sm px-2 text-left text-label transition-colors duration-[80ms] hover:bg-hover"
          >
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full cursor-pointer items-center gap-2 text-left"
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-invert text-[0.6875rem] font-semibold text-invert-fg">
          {initialsOf(fullName)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-label">{fullName}</div>
          <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-slate">
            {roleLabel}
          </div>
        </div>
      </button>
    </div>
  )
}
