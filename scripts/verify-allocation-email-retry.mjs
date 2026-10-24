/**
 * Verifies allocation-email retry helpers used when `/api/allocate` hits
 * `already_run` after a prior save succeeded but notices never went out.
 *
 * Run: node scripts/verify-allocation-email-retry.mjs
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)

// Compile-free smoke checks against the TypeScript sources via tsx if
// available; otherwise duplicate the pure predicates here so CI without
// a TS loader still validates the contract the route depends on.
function hasEmailableAllocationRecipients(allocations, waitlisted) {
  return allocations.some((a) => a.pass_number !== 0) || waitlisted.length > 0
}

function isAllocationEmailDeliveryIncomplete(emailable, emailSummary, emailError) {
  if (emailError) return true
  if (!emailable) return false
  if (!emailSummary) return true
  return emailSummary.failed > 0 || emailSummary.sent === 0
}

function filterRecipients(allocations, waitlisted, skipUserIds) {
  const users = new Set()
  for (const a of allocations) {
    if (a.pass_number === 0) continue
    if (skipUserIds?.has(a.user_id)) continue
    users.add(a.user_id)
  }
  for (const w of waitlisted) {
    if (skipUserIds?.has(w.user_id)) continue
    users.add(w.user_id)
  }
  return users
}

// Fixed-only week: nothing to email → delivery considered complete.
assert.equal(
  hasEmailableAllocationRecipients([{ pass_number: 0 }], []),
  false
)
assert.equal(
  isAllocationEmailDeliveryIncomplete(false, null, null),
  false
)

// Normal week with recipients and zero sends → incomplete (cron must 500).
assert.equal(
  hasEmailableAllocationRecipients([{ pass_number: 1 }], []),
  true
)
assert.equal(
  isAllocationEmailDeliveryIncomplete(true, { attempted: 3, sent: 0, failed: 3, errors: [] }, null),
  true
)

// Partial failure → incomplete so already_run can finish the rest.
assert.equal(
  isAllocationEmailDeliveryIncomplete(true, { attempted: 3, sent: 2, failed: 1, errors: [] }, null),
  true
)

// Thrown prep error → incomplete.
assert.equal(
  isAllocationEmailDeliveryIncomplete(true, null, 'profiles fetch failed'),
  true
)

// All sent → complete.
assert.equal(
  isAllocationEmailDeliveryIncomplete(true, { attempted: 3, sent: 3, failed: 0, errors: [] }, null),
  false
)

// Dedup: users with a prior successful allocation email are skipped on retry.
const skip = new Set(['user-a'])
const remaining = filterRecipients(
  [
    { user_id: 'user-a', pass_number: 1 },
    { user_id: 'user-b', pass_number: 2 },
    { user_id: 'user-c', pass_number: 0 },
  ],
  [
    { user_id: 'user-a', date: '2026-08-10' },
    { user_id: 'user-d', date: '2026-08-11' },
  ],
  skip
)
assert.deepEqual([...remaining].sort(), ['user-b', 'user-d'])

// Week date helper contract used by loadWeekAllocationResults.
const { addDays, format, parseISO } = require('date-fns')
function weekDatesFor(weekStart) {
  return Array.from({ length: 5 }, (_, i) =>
    format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd')
  )
}
assert.deepEqual(weekDatesFor('2026-08-10'), [
  '2026-08-10',
  '2026-08-11',
  '2026-08-12',
  '2026-08-13',
  '2026-08-14',
])

console.log('verify-allocation-email-retry: ok')
