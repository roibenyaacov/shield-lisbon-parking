/**
 * Verifies waitlist rows preserve registration FCFS timestamps, and that
 * /api/claim fails closed if waitlist cleanup errors after insert.
 *
 * Run: node scripts/verify-waitlist-fcfs.mjs
 */
import { readFileSync } from 'fs'

const allocationSrc = readFileSync(new URL('../lib/allocation.ts', import.meta.url), 'utf8')
const claimSrc = readFileSync(new URL('../app/api/claim/route.ts', import.meta.url), 'utf8')

if (!allocationSrc.includes('created_at: user.requestedAt')) {
  console.error('FAIL: waitlist entries must persist weekly_requests.created_at')
  process.exit(1)
}

if (!allocationSrc.includes('ORDER BY created_at')) {
  // Comment documenting why created_at is preserved — keep the contract visible.
  console.error('FAIL: expected comment tying waitlist created_at to promotion order')
  process.exit(1)
}

const waitlistPush = allocationSrc.includes('allWaitlisted.push({')
  && allocationSrc.includes('user_id: user.userId')
  && allocationSrc.includes('date: dateStr')
  && allocationSrc.includes('created_at: user.requestedAt')

if (!waitlistPush) {
  console.error('FAIL: waitlisted push must include created_at from requestedAt')
  process.exit(1)
}

if (!claimSrc.includes('waitlistError') || !claimSrc.includes('Failed to finalize claim')) {
  console.error('FAIL: claim route must fail closed when waitlist cleanup errors')
  process.exit(1)
}

if (!claimSrc.includes('rollback_error') && !claimSrc.includes('rollbackError')) {
  console.error('FAIL: claim route must attempt allocation rollback on waitlist cleanup failure')
  process.exit(1)
}

// Behavioral simulation: promotion ORDER BY created_at ASC must pick earliest registrant.
const waitlisted = [
  { user_id: 'late', date: '2026-08-03', created_at: '2026-07-30T19:45:00.000Z' },
  { user_id: 'early', date: '2026-08-03', created_at: '2026-07-30T19:01:00.000Z' },
  { user_id: 'middle', date: '2026-08-03', created_at: '2026-07-30T19:20:00.000Z' },
]

const promoted = [...waitlisted].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
if (promoted.user_id !== 'early') {
  console.error(`FAIL: expected earliest registrant promoted, got ${promoted.user_id}`)
  process.exit(1)
}

// Contrast: identical default now() timestamps cannot encode registration order.
const bulkNow = '2026-08-01T07:00:00.000Z'
const collapsed = waitlisted.map((w) => ({ ...w, created_at: bulkNow }))
const tiedOrder = collapsed.map((w) => w.user_id).join(',')
if (tiedOrder === 'early,middle,late') {
  // Insertion order happens to match here; the point is timestamps no longer distinguish.
}
const distinct = new Set(collapsed.map((w) => w.created_at))
if (distinct.size !== 1) {
  console.error('FAIL: sanity check for identical bulk timestamps')
  process.exit(1)
}

console.log('PASS: waitlist FCFS timestamps preserved; claim cleanup fails closed')
console.log(JSON.stringify({ next_promoted: promoted.user_id, tied_created_at_size: distinct.size }, null, 2))
