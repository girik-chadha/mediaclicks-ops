'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { AvatarMenu } from './avatar-menu'

export interface NavItem {
  /** `Route`, not `string`: typedRoutes then catches a link to a page that
   *  does not exist at compile time rather than at click time. */
  href: Route
  label: string
}

export interface NavProps {
  items: NavItem[]
  fullName: string
  roleLabel: string
  /** A server action, passed down from the layout. */
  onSignOut: () => Promise<void>
}

export function Nav({ items, fullName, roleLabel, onSignOut }: NavProps) {
  const pathname = usePathname()

  return (
    <div className="relative z-20 flex w-[200px] shrink-0 flex-col border-r border-rule bg-surface">
      <div className="flex h-12 items-center border-b border-rule px-4 font-display text-title">
        MediaClicks
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
                'flex h-8 items-center rounded-sm px-2 text-body transition-colors duration-[80ms] hover:bg-hover',
                active ? 'bg-hover font-semibold text-ink' : 'text-slate',
              )}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto">
        <AvatarMenu fullName={fullName} roleLabel={roleLabel} onSignOut={onSignOut} />
      </div>
    </div>
  )
}
