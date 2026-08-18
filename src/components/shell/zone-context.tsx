'use client'

import { createContext, useContext } from 'react'

/**
 * The signed-in person's chosen zone, available to the shell.
 *
 * The Rail, the clock and the date stamp sit above every screen and none of
 * them is passed a meeting, so none of them had a zone to render in. They
 * used the browser's — which is a different thing from the zone the person
 * picked in Profile, and the difference is invisible until the two disagree.
 * Then the calendar says 18:00, the rail says 16:30, and changing the
 * setting appears to do nothing at all, because the one element showing a
 * timezone name was never reading the setting.
 *
 * Context rather than props because PageHeader is rendered by a dozen
 * screens and threading a zone through every one of them would mean a dozen
 * chances to forget.
 *
 * Null outside the app shell — the login screen has a Rail and no actor. The
 * readers fall back to the browser's zone there, which is the only thing
 * available and is honest at that point.
 */
const ZoneContext = createContext<string | null>(null)

export function ZoneProvider({
  zone,
  children,
}: {
  zone: string
  children: React.ReactNode
}) {
  return <ZoneContext.Provider value={zone}>{children}</ZoneContext.Provider>
}

export function useZone(): string | null {
  return useContext(ZoneContext)
}
