'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface PaletteItem {
  id: string
  label: string
  meta: string
  group: string
  href: string
}

/**
 * ⌘K / Ctrl-K jump-to (design §palette).
 *
 * Fixed 560px, opens 96px from the top, groups results with micro eyebrows,
 * and carries a mono hint bar along the bottom.
 */
export function CommandPalette({ items = [] }: { items?: PaletteItem[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQuery('')
        setIndex(0)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus())
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = items ?? []
    return q ? all.filter((i) => `${i.label} ${i.meta}`.toLowerCase().includes(q)) : all
  }, [items, query])

  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>()
    for (const item of matches) {
      map.set(item.group, [...(map.get(item.group) ?? []), item])
    }
    return [...map.entries()]
  }, [matches])

  if (!open) return null

  const flat = groups.flatMap(([, list]) => list)

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (i + 1) % Math.max(1, flat.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (i - 1 + flat.length) % Math.max(1, flat.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = flat[index]
      if (chosen) window.location.href = chosen.href
    }
  }

  let running = -1

  return (
    <div
      className="animate-veil-in fixed inset-0 z-50 flex items-start justify-center bg-veil pt-24"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-modal-in w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-sm border border-rule bg-surface shadow-float"
      >
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Jump to a meeting, person or screen"
          className="h-12 w-full border-b border-rule bg-surface px-4 text-body outline-none"
        />

        <div className="max-h-[360px] overflow-auto py-2">
          {groups.length === 0 ? (
            <div className="px-4 py-6 text-body text-slate">Nothing matches {query}.</div>
          ) : (
            groups.map(([group, list]) => (
              <div key={group}>
                <div className="px-4 pb-1 pt-2 text-micro uppercase text-slate">{group}</div>
                {list.map((item) => {
                  running += 1
                  const active = running === index
                  return (
                    <a
                      key={item.id}
                      href={item.href}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left"
                      style={{ background: active ? 'var(--hover)' : 'transparent' }}
                      onMouseEnter={() => setIndex(flat.indexOf(item))}
                    >
                      <span className="min-w-0 flex-1 truncate text-body text-ink">
                        {item.label}
                      </span>
                      <span className="font-mono text-[0.6875rem] tracking-[-0.02em] text-slate">
                        {item.meta}
                      </span>
                    </a>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex gap-4 border-t border-rule px-4 py-2 font-mono text-[0.5625rem] tracking-[-0.02em] text-slate">
          <span>↑↓ move</span>
          <span>⏎ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
