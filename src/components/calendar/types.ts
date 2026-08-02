/** Meetings crossing the server/client boundary carry ISO strings. */
export interface MeetingDto {
  id: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  type: 'client' | 'internal'
  status: 'scheduled' | 'cancelled' | 'completed'
  conferencingProvider: 'google_meet' | 'zoom' | 'whatsapp' | 'none'
  conferenceUrl: string | null
  clientId: string | null
  clientName: string | null
  clientPhone: string | null
  attendees: { id: string; fullName: string; response: string }[]
  /** Decided server-side by can(). The UI hides; the server enforces (§3). */
  canEdit: boolean
  canCancel: boolean
  /** A link-based platform was chosen but no link was pasted. */
  missingLink: boolean
}

export interface PersonDto {
  id: string
  fullName: string
}

export interface ClientDto {
  id: string
  companyName: string
  region: 'domestic' | 'international'
}
