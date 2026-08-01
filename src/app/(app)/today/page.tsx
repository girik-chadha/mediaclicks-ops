import { TodayStamp } from '@/components/shell/today-stamp'
import { getActor } from '@/server/auth/session'

export default async function TodayPage() {
  const actor = await getActor()

  return (
    <div>
      <header className="flex h-12 items-center justify-between border-b border-rule bg-surface px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-title">Today</h1>
          <TodayStamp />
        </div>
      </header>

      <div className="p-6">
        {/* Brief §8: empty states say what is true and offer the next action.
            They do not apologise. The calendar arrives in Phase 2, so this
            says so rather than showing an empty grid that looks broken. */}
        <div className="rounded-sm border border-rule bg-surface p-8">
          <p className="font-display text-display-sm">Nothing scheduled</p>
          <p className="mt-2 max-w-prose text-body text-slate">
            Scheduling arrives in Phase 2. You are signed in as{' '}
            <span className="text-ink">{actor?.email}</span> with{' '}
            {actor?.permissions.size ?? 0} permissions granted through{' '}
            {actor?.roleNames.join(', ') || 'no role'}.
          </p>
        </div>
      </div>
    </div>
  )
}
