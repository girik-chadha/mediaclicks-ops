import { Rail } from '@/components/shell/rail'

/**
 * The Rail is present on the login screen too (brief §4, §6.7): "someone who
 * hasn't logged in yet can already see the app has a pulse."
 *
 * `main` centres nothing and pads nothing. Login is a full-bleed two-panel
 * composition that has to reach the edges; forgot and reset are single cards
 * that centre themselves. Putting the centring here would mean the login page
 * spending its first rule undoing the layout's.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-paper text-ink">
      <div className="hidden md:flex">
        <Rail />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="md:hidden">
          <Rail orientation="horizontal" />
        </div>
        <main className="flex min-h-0 min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
