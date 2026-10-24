/**
 * First Lisbon hour (inclusive) at which the Friday allocation cron may run.
 * Hours 6 and 7 are before the 08:00 request close; that lower bound is
 * unchanged so an on-time winter run (07:00 UTC = 07:00 WET) still allocates.
 */
export const ALLOCATION_WINDOW_START_HOUR = 6

/**
 * Cron-auth allocation window: `allocationDay` (Friday), from 06:00 Lisbon
 * through the end of that day. There is no upper hour bound.
 *
 * The job is scheduled at 07:00 UTC, but GitHub Actions has started it
 * after the old `lisbonHour > 12` cutoff:
 *   2026-09-18 12:01 UTC → Lisbon hour 13, skipped
 *   2026-09-25 12:30 UTC → Lisbon hour 13, skipped
 *   2026-08-28 19:12 UTC → Lisbon hour 20, skipped
 * Each of those returned HTTP 200 `skipped: true` and published no spots.
 *
 * A second successful call the same Friday is stopped by the Monday-row
 * idempotency check in the allocate route, not by this window.
 */
export function isCronAllocationWindow(
  lisbonDay: number,
  lisbonHour: number,
  allocationDay: number,
): boolean {
  return lisbonDay === allocationDay && lisbonHour >= ALLOCATION_WINDOW_START_HOUR
}
