'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoMark } from './logo'

export interface MobileNavItem {
  href: Route
  label: string
}

/**
 * Navigation below the md breakpoint, where the 200px sidebar cannot fit.
 *
 * A horizontal strip rather than a hamburger: there are four or five
 * destinations, and hiding four items behind a tap is a menu protecting
 * nothing. The spec calls mobile a "notification and read-only surface"
 * (§0), so this is for getting to a screen, not for administering anything —
 * sign-out lives on the profile screen instead of being crammed in here.
 */
export function MobileNav({ items }: { items: MobileNavItem[] }) {
  const pathname = usePathname()

  return (
    <div className="flex h-11 items-center gap-1 border-b border-rule bg-surface px-2">
      <LogoMark size={16} className="mx-1 text-ink" />
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="shrink-0 rounded-sm px-2 py-1 text-label transition-colors duration-[80ms]"
              style={{
                background: active ? 'var(--hover)' : 'transparent',
                color: active ? 'var(--ink)' : 'var(--slate)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
      <Link
        href="/profile"
        aria-label="Profile"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-invert text-[0.625rem] font-semibold text-invert-fg"
      >
        ·
      </Link>
    </div>
  )
}
