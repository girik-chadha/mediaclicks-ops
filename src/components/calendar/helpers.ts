import { providerLabel } from '@/lib/meetings/schema'
import type { MeetingDto } from './types'

export { formatRange } from '@/lib/time'

export function providerLabelSafe(p: MeetingDto['conferencingProvider']): string {
  return providerLabel(p)
}
