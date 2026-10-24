import { format, nextMonday, startOfWeek } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { LISBON_TIMEZONE } from './constants'

/**
 * Default `week_start` for `/api/allocate` when the caller does not override it.
 *
 * Friday–Sunday: the upcoming Monday — the week whose registration window just
 * closed (or is closing) on Friday morning.
 *
 * Monday–Thursday: this week's Monday. After a missed Friday cron the parking
 * week has already started, and `nextMonday(Monday)` would allocate the
 * *following* week, leave the current week empty, and plant a Monday row that
 * makes the next Friday run report `already_run`.
 */
export function getDefaultAllocationWeekStart(now: Date = new Date()): string {
  const lisbon = toZonedTime(now, LISBON_TIMEZONE)
  const day = lisbon.getDay() // 0 Sun … 5 Fri, 6 Sat

  if (day === 5 || day === 6 || day === 0) {
    return format(nextMonday(lisbon), 'yyyy-MM-dd')
  }

  return format(startOfWeek(lisbon, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}
