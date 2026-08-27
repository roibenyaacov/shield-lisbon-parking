/**
 * Verifies Resend send pacing, 429 retry decisions, reminder delivery
 * completeness, and reminder-retry recipient skip used by `/api/remind`.
 *
 * Production trigger (every Wednesday since this helper landed): 25
 * reminder recipients, SEND_CONCURRENCY=5, Resend 10 req/s → 10 sent,
 * 15 failed, HTTP 200 so GitHub Actions stayed green.
 *
 * Run: node scripts/verify-resend-rate-limit.mjs
 */

import assert from 'node:assert/strict'

const RESEND_MIN_INTERVAL_MS = 120
const RESEND_RATE_LIMIT_COOLDOWN_MS = 1100
const REMINDER_DEDUPE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000

function isResendRateLimitError(message) {
  return /too many requests|rate limit/i.test(message)
}

function scheduleSendSlot(state, nowMs, minIntervalMs = RESEND_MIN_INTERVAL_MS) {
  const slotMs = Math.max(nowMs, state.nextSlotMs)
  return {
    waitMs: slotMs - nowMs,
    nextState: { nextSlotMs: slotMs + minIntervalMs },
  }
}

function applyRateLimitCooldown(
  state,
  nowMs,
  cooldownMs = RESEND_RATE_LIMIT_COOLDOWN_MS
) {
  return { nextSlotMs: Math.max(state.nextSlotMs, nowMs + cooldownMs) }
}

function isReminderEmailDeliveryIncomplete(summary) {
  return summary.failed > 0
}

function filterReminderRecipients(profiles, fixedOwnerIds, skipUserIds, skipEmails) {
  return profiles.filter((p) => {
    if (!p.email || fixedOwnerIds.has(p.id)) return false
    if (skipUserIds?.has(p.id)) return false
    if (skipEmails?.has(p.email.toLowerCase())) return false
    return true
  })
}

function startsInRollingWindow(startTimes, windowMs = 1000) {
  let max = 0
  for (let i = 0; i < startTimes.length; i++) {
    let count = 0
    for (let j = i; j < startTimes.length; j++) {
      if (startTimes[j] - startTimes[i] < windowMs) count++
      else break
    }
    if (count > max) max = count
  }
  return max
}

// ── Rate-limit error detection ──────────────────────────────────────────
assert.equal(
  isResendRateLimitError(
    'Too many requests. You can only make 10 requests per second. See rate limit response headers for more information. Or contact support to increase rate limit.'
  ),
  true
)
assert.equal(isResendRateLimitError('rate limit exceeded'), true)
assert.equal(isResendRateLimitError('Invalid API key'), false)

// ── Pacing: 25 starts stay under 10 req/s ───────────────────────────────
let state = { nextSlotMs: 0 }
const startTimes = []
let now = 0
for (let i = 0; i < 25; i++) {
  const scheduled = scheduleSendSlot(state, now)
  state = scheduled.nextState
  const startAt = now + scheduled.waitMs
  startTimes.push(startAt)
  now = startAt
}

assert.equal(startTimes[0], 0)
assert.equal(startTimes[1], 120)
assert.equal(startTimes[24], 24 * 120)
assert.ok(
  startsInRollingWindow(startTimes) <= 9,
  `rolling 1s window had ${startsInRollingWindow(startTimes)} starts, expected <= 9`
)

// Unpaced concurrency-5 burst (the production failure mode): 5 workers
// finishing in 150ms can start >10 sends in the first second.
const unpaced = []
for (let wave = 0; wave < 5; wave++) {
  for (let w = 0; w < 5; w++) unpaced.push(wave * 150)
}
assert.ok(
  startsInRollingWindow(unpaced) >= 10,
  'unpaced burst fixture should exceed 10 req/s'
)

// ── 429 cooldown pushes the next start out of the current window ────────
state = { nextSlotMs: 240 }
state = applyRateLimitCooldown(state, 200)
assert.equal(state.nextSlotMs, 200 + 1100)
const afterCooldown = scheduleSendSlot(state, 300)
assert.equal(afterCooldown.waitMs, 200 + 1100 - 300)

// ── Reminder delivery completeness (cron HTTP status) ───────────────────
assert.equal(
  isReminderEmailDeliveryIncomplete({ attempted: 25, sent: 10, failed: 15, errors: [] }),
  true
)
assert.equal(
  isReminderEmailDeliveryIncomplete({ attempted: 25, sent: 25, failed: 0, errors: [] }),
  false
)
assert.equal(
  isReminderEmailDeliveryIncomplete({ attempted: 0, sent: 0, failed: 0, errors: [] }),
  false
)

// ── Retry skip: already-sent recipients are not attempted again ─────────
const remaining = filterReminderRecipients(
  [
    { id: 'a', email: 'a@shieldfc.com' },
    { id: 'b', email: 'b@shieldfc.com' },
    { id: 'c', email: 'c@shieldfc.com' },
    { id: 'fixed', email: 'fixed@shieldfc.com' },
    { id: 'd', email: null },
  ],
  new Set(['fixed']),
  new Set(['a']),
  new Set(['b@shieldfc.com'])
)
assert.deepEqual(
  remaining.map((p) => p.id),
  ['c']
)

// Dedupe window is shorter than a week so next Wednesday is not skipped.
assert.ok(REMINDER_DEDUPE_WINDOW_MS < 7 * 24 * 60 * 60 * 1000)
assert.ok(REMINDER_DEDUPE_WINDOW_MS > 2 * 24 * 60 * 60 * 1000)

console.log('verify-resend-rate-limit: all assertions passed')
