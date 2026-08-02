'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { AvatarMenu } from './avatar-menu'
import { CommandPalette, type PaletteItem } from './command-palette'
import { Wordmark } from './logo'

export interface NavItem {
  /** `Route`, not `string`: typedRoutes then catches a link to a page that
   *  does not exist at compile time rather than at click time. */
  href: Route
  label: string
  /** Mono count on the right, as in the design. Blank when there is none. */
  count?: string
  /** Renders the count in --signal, for anything wanting attention. */
  accent?: boolean
}

export interface NavProps {
  items: NavItem[]
  fullName: string
  roleLabel: string
  loadPalette: () => Promise<PaletteItem[]>
  /** A server action, passed down from the layout. */
  onSignOut: () => Promise<void>
}

export function Nav({ items, fullName, roleLabel, loadPalette, onSignOut }: NavProps) {
  const pathname = usePathname()

  return (
    <div className="relative z-20 flex w-[200px] shrink-0 flex-col border-r border-rule bg-surface">
      <div className="flex h-12 items-center border-b border-rule px-4">
        <Wordmark size={18} />
      </div>

      <nav className="flex flex-col gap-0.5 p-2 pt-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center justify-between gap-2 rounded-sm px-2 text-body transition-colors duration-[80ms] hover:bg-hover',
                active ? 'bg-hover font-semibold text-ink' : 'text-slate',
              )}
            >
              <span>{item.label}</span>
              {item.count && (
                <span
                  className="font-mono text-[0.6875rem] tracking-[-0.02em]"
                  style={{ color: item.accent ? 'var(--signal)' : 'var(--slate)' }}
                >
                  {item.count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* The palette's own affordance — the design puts it here, under nav. */}
      <button
        type="button"
        onClick={() =>
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
          )
        }
        className="mx-2 flex h-7 cursor-pointer items-center justify-between rounded-sm border border-rule px-2 text-label text-slate transition-colors duration-[80ms] hover:border-signal"
      >
        <span>Search</span>
        <span className="font-mono text-[0.5625rem] tracking-[-0.02em]">⌘K</span>
      </button>

      <div className="mt-auto">
        <AvatarMenu fullName={fullName} roleLabel={roleLabel} onSignOut={onSignOut} />
      </div>

      <CommandPalette load={loadPalette} />
    </div>
  )
}
