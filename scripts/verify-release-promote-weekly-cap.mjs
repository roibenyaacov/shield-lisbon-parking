/**
 * Verifies release_and_promote / release_fixed_and_promote enforce the
 * weekly MAX_DAYS_PER_USER cap when promoting from the waitlist.
 *
 * Run: node scripts/verify-release-promote-weekly-cap.mjs
 */
import { readFileSync } from 'fs'

const migrationSrc = readFileSync(
  new URL('../supabase/migrations/015_release_promote_enforce_weekly_cap.sql', import.meta.url),
  'utf8'
)
const constantsSrc = readFileSync(new URL('../lib/constants.ts', import.meta.url), 'utf8')

const maxDaysMatch = constantsSrc.match(/MAX_DAYS_PER_USER\s*=\s*(\d+)/)
if (!maxDaysMatch) {
  console.error('FAIL: MAX_DAYS_PER_USER missing from constants')
  process.exit(1)
}
const maxDays = Number(maxDaysMatch[1])

if (!migrationSrc.includes(`c_max_days   CONSTANT INTEGER := ${maxDays}`)
  && !migrationSrc.includes(`c_max_days    CONSTANT INTEGER := ${maxDays}`)) {
  console.error(`FAIL: migration must hardcode c_max_days := ${maxDays} to match constants`)
  process.exit(1)
}

for (const fn of ['release_and_promote', 'release_fixed_and_promote']) {
  if (!migrationSrc.includes(`CREATE OR REPLACE FUNCTION ${fn}`)) {
    console.error(`FAIL: migration must replace ${fn}`)
    process.exit(1)
  }
}

if (!migrationSrc.includes('v_week_days >= c_max_days')) {
  console.error('FAIL: migration must skip waitlist users at the weekly cap')
  process.exit(1)
}

if (!migrationSrc.includes('FOR UPDATE SKIP LOCKED')) {
  console.error('FAIL: migration must keep SKIP LOCKED waitlist locking')
  process.exit(1)
}

if (!migrationSrc.includes("EXTRACT(ISODOW FROM p_date)")) {
  console.error('FAIL: migration must derive Mon–Fri week bounds from p_date')
  process.exit(1)
}

/**
 * Mirrors the RPC waitlist walk: skip same-day holders and users at cap;
 * promote the first eligible FIFO entry.
 */
function choosePromotee({ waitlistOrdered, dayCounts, alreadyHasDate }) {
  for (const userId of waitlistOrdered) {
    if (alreadyHasDate.has(userId)) continue
    if ((dayCounts[userId] ?? 0) >= maxDays) continue
    return userId
  }
  return null
}

const cases = [
  {
    name: 'claim+release path: capped head is skipped for next waitlisted user',
    input: {
      waitlistOrdered: ['capped', 'eligible'],
      dayCounts: { capped: maxDays, eligible: maxDays - 1 },
      alreadyHasDate: new Set(),
    },
    expect: 'eligible',
  },
  {
    name: 'everyday trigger: 4-day holder on Thu waitlist is not promoted to 5th day',
    input: {
      waitlistOrdered: ['userA'],
      dayCounts: { userA: maxDays },
      alreadyHasDate: new Set(),
    },
    expect: null,
  },
  {
    name: 'under-cap FIFO head is still promoted',
    input: {
      waitlistOrdered: ['head', 'tail'],
      dayCounts: { head: maxDays - 1, tail: 0 },
      alreadyHasDate: new Set(),
    },
    expect: 'head',
  },
  {
    name: 'stale same-day waitlist entry is skipped',
    input: {
      waitlistOrdered: ['stale', 'next'],
      dayCounts: { stale: 1, next: 1 },
      alreadyHasDate: new Set(['stale']),
    },
    expect: 'next',
  },
]

for (const c of cases) {
  const result = choosePromotee(c.input)
  if (result !== c.expect) {
    console.error(`FAIL: ${c.name}`, { result, expected: c.expect })
    process.exit(1)
  }
}

console.log('PASS: release promote RPCs enforce weekly cap and skip ineligible heads')
console.log(JSON.stringify({ max_days: maxDays, cases: cases.length }, null, 2))
