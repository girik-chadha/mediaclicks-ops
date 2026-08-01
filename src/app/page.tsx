import { redirect } from 'next/navigation'

export default function RootPage() {
  // Today is the landing screen after login (brief §6.1). Middleware sends
  // unauthenticated traffic to /login before this runs.
  redirect('/today')
}
