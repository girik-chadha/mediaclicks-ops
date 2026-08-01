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
  clientName: string | null
  clientPhone: string | null
  attendees: { id: string; fullName: string; response: string }[]
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
