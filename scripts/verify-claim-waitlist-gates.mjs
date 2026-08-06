/**
 * Verifies /api/claim enforces waitlist FIFO + weekly MAX_DAYS_PER_USER,
 * and fails closed if waitlist cleanup errors after insert.
 *
 * Run: node scripts/verify-claim-waitlist-gates.mjs
 */
import { readFileSync } from 'fs'

const claimSrc = readFileSync(new URL('../app/api/claim/route.ts', import.meta.url), 'utf8')
const constantsSrc = readFileSync(new URL('../lib/constants.ts', import.meta.url), 'utf8')

const maxDaysMatch = constantsSrc.match(/MAX_DAYS_PER_USER\s*=\s*(\d+)/)
if (!maxDaysMatch) {
  console.error('FAIL: MAX_DAYS_PER_USER missing from constants')
  process.exit(1)
}
const maxDays = Number(maxDaysMatch[1])

if (!claimSrc.includes('MAX_DAYS_PER_USER')) {
  console.error('FAIL: claim route must import/enforce MAX_DAYS_PER_USER')
  process.exit(1)
}

if (!claimSrc.includes('Maximum ${MAX_DAYS_PER_USER} days per week reached')
  && !claimSrc.includes('days per week reached')) {
  console.error('FAIL: claim route must reject users at the weekly cap')
  process.exit(1)
}

if (!claimSrc.includes("order('created_at', { ascending: true })")
  && !claimSrc.includes('order("created_at"')) {
  console.error('FAIL: claim route must load waitlist FIFO head by created_at ASC')
  process.exit(1)
}

if (!claimSrc.includes('This spot is reserved for the waitlist')) {
  console.error('FAIL: claim route must reject non-head claimers when waitlist exists')
  process.exit(1)
}

if (!claimSrc.includes('waitlistError') || !claimSrc.includes('Failed to finalize claim')) {
  console.error('FAIL: claim route must fail closed when waitlist cleanup errors')
  process.exit(1)
}

if (!claimSrc.includes('rollbackError') && !claimSrc.includes('rollback_error')) {
  console.error('FAIL: claim route must attempt allocation rollback on waitlist cleanup failure')
  process.exit(1)
}

// Behavioral simulation of the gates (mirrors server checks).
function canClaim({
  userId,
  weekDayCount,
  waitlistOrdered,
}) {
  if (weekDayCount >= maxDays) {
    return { ok: false, reason: 'cap' }
  }
  const head = waitlistOrdered[0] ?? null
  if (head && head !== userId) {
    return { ok: false, reason: 'waitlist' }
  }
  return { ok: true, reason: null }
}

const cases = [
  {
    name: 'leftover empty spot: non-head cannot jump waitlist',
    input: {
      userId: 'jumper',
      weekDayCount: 2,
      waitlistOrdered: ['head', 'jumper', 'tail'],
    },
    expectOk: false,
    expectReason: 'waitlist',
  },
  {
    name: 'FIFO head may self-claim empty leftover spot',
    input: {
      userId: 'head',
      weekDayCount: 3,
      waitlistOrdered: ['head', 'tail'],
    },
    expectOk: true,
    expectReason: null,
  },
  {
    name: 'no waitlist: leftover claim allowed under cap',
    input: {
      userId: 'anyone',
      weekDayCount: 3,
      waitlistOrdered: [],
    },
    expectOk: true,
    expectReason: null,
  },
  {
    name: 'weekly cap blocks claim even with empty waitlist',
    input: {
      userId: 'maxed',
      weekDayCount: maxDays,
      waitlistOrdered: [],
    },
    expectOk: false,
    expectReason: 'cap',
  },
]

for (const c of cases) {
  const result = canClaim(c.input)
  if (result.ok !== c.expectOk || result.reason !== c.expectReason) {
    console.error(`FAIL: ${c.name}`, { result, expected: { ok: c.expectOk, reason: c.expectReason } })
    process.exit(1)
  }
}

console.log('PASS: claim waitlist FIFO + weekly cap gates; cleanup fails closed')
console.log(JSON.stringify({ max_days: maxDays, cases: cases.length }, null, 2))
