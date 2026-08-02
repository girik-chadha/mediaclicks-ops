import { HeaderActions } from './header-actions'
import { TodayStamp } from './today-stamp'

/**
 * The 48px bar above every screen. One definition, not one per page.
 *
 * Matches the design's header: title in the display face, today's stamp in
 * mono beside it, and the actions right-aligned.
 */
export function PageHeader({
  title,
  actions,
}: {
  title: string
  /** Screen-specific controls, placed left of the shared ones. */
  actions?: React.ReactNode
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-rule bg-surface px-6">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-title">{title}</h1>
        <TodayStamp />
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <HeaderActions />
      </div>
    </header>
  )
}
