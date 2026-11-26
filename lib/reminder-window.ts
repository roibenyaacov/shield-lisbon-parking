/**
 * Lisbon wall-clock time, as produced by `toZonedTime(now, LISBON_TIMEZONE)`.
 * Callers must pass that zoned Date. `getDay` / `getHours` read its components.
 *
 * The reminder cron is a single Wednesday 17:00 UTC schedule. GitHub Actions
 * often starts it hours later. Wednesday (day 3, `REQUEST_OPEN_DAY`) from
 * 15:00 still sends. A start after midnight is Thursday in Lisbon, and
 * registration stays open all Thursday (until Friday 08:00), so Thursday sends
 * too.
 *
 * Friday is left out: the window closes at 08:00, and no scheduled run has
 * landed that late. There is still only one schedule, so this does not add a
 * second send.
 */
export function isReminderCronWindow(lisbonNow: Date): boolean {
  const day = lisbonNow.getDay()
  const hour = lisbonNow.getHours()

  // Wednesday from 15:00. 3 is REQUEST_OPEN_DAY.
  if (day === 3 && hour >= 15) return true
  // Thursday, the day after registration opens.
  if (day === 4) return true
  return false
}
