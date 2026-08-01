import { redirect } from 'next/navigation'

export default function RootPage() {
  // Home is the landing screen — it leads the nav in the design. Middleware
  // sends unauthenticated traffic to /login before this runs.
  redirect('/home')
}
