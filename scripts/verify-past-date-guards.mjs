/**
 * Deterministic checks for Lisbon past-date helpers used by claim/release.
 * Run: node scripts/verify-past-date-guards.mjs
 */
import assert from 'node:assert/strict'
import { formatInTimeZone } from 'date-fns-tz'
import { addDays, format, parseISO } from 'date-fns'

const LISBON_TIMEZONE = 'Europe/Lisbon'

function getLisbonToday(now = new Date()) {
  return formatInTimeZone(now, LISBON_TIMEZONE, 'yyyy-MM-dd')
}

function isPastLisbonDate(date, now = new Date()) {
  return date < getLisbonToday(now)
}

// Fixed instant: 2026-07-31 10:00 UTC == 11:00 Lisbon (WEST)
const now = new Date('2026-07-31T10:00:00.000Z')
const today = getLisbonToday(now)
assert.equal(today, '2026-07-31')

assert.equal(isPastLisbonDate('2026-07-30', now), true)
assert.equal(isPastLisbonDate('2026-07-31', now), false)
assert.equal(isPastLisbonDate('2026-08-01', now), false)

// Near midnight Lisbon: 2026-08-01 00:30 WEST == 2026-07-31 23:30 UTC
const justAfterMidnightLisbon = new Date('2026-07-31T23:30:00.000Z')
assert.equal(getLisbonToday(justAfterMidnightLisbon), '2026-08-01')
assert.equal(isPastLisbonDate('2026-07-31', justAfterMidnightLisbon), true)
assert.equal(isPastLisbonDate('2026-08-01', justAfterMidnightLisbon), false)

// Winter (WET): 2026-01-15 10:00 UTC == 10:00 Lisbon
const winter = new Date('2026-01-15T10:00:00.000Z')
assert.equal(getLisbonToday(winter), '2026-01-15')
assert.equal(isPastLisbonDate('2026-01-14', winter), true)
assert.equal(isPastLisbonDate('2026-01-15', winter), false)

// Sanity: yesterday relative to "now" is always past
const yesterday = format(addDays(parseISO(today), -1), 'yyyy-MM-dd')
assert.equal(isPastLisbonDate(yesterday, now), true)

console.log('verify-past-date-guards: ok')
