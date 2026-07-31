import { formatInTimeZone } from 'date-fns-tz'
import { LISBON_TIMEZONE } from '@/lib/constants'

/** Today's calendar date in Europe/Lisbon as `yyyy-MM-dd`. */
export function getLisbonToday(): string {
  return formatInTimeZone(new Date(), LISBON_TIMEZONE, 'yyyy-MM-dd')
}

/**
 * True when `date` (yyyy-MM-dd) is strictly before today's Lisbon date.
 * Today remains mutable so same-day release/claim/reclaim still works.
 */
export function isPastLisbonDate(date: string): boolean {
  return date < getLisbonToday()
}
