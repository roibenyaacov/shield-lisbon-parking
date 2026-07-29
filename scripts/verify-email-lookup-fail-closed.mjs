/**
 * Verifies notification recipient lookups fail closed on Supabase errors.
 *
 * Reproduces the pre-fix control flow and asserts the fixed behavior:
 * a profiles/spots/fixed-owners read error must throw (so allocate/remind
 * can surface email_error / HTTP 500) instead of returning attempted: 0.
 */

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

/** Pre-fix: coerce error responses to empty arrays and continue. */
function legacyBuildPayloadCount(profilesRes, spotsRes, userIds) {
  const profiles = profilesRes.data ?? []
  const spots = spotsRes.data ?? []
  const profileMap = new Map(profiles.map((p) => [p.id, p]))
  const spotMap = new Map(spots.map((s) => [s.id, s]))
  let payloads = 0
  for (const userId of userIds) {
    const profile = profileMap.get(userId)
    if (!profile?.email) continue
    // Spot map emptiness only affects labels; emails would still be attempted.
    void spotMap
    payloads++
  }
  return payloads
}

/** Fixed: throw before building payloads when lookups fail. */
function failClosedBuildPayloadCount(profilesRes, spotsRes, userIds) {
  if (profilesRes.error) {
    throw new Error(
      `Failed to load profiles for allocation emails: ${profilesRes.error.message}`
    )
  }
  if (spotsRes.error) {
    throw new Error(
      `Failed to load parking spots for allocation emails: ${spotsRes.error.message}`
    )
  }
  return legacyBuildPayloadCount(profilesRes, spotsRes, userIds)
}

/** Pre-fix reminder recipient selection. */
function legacyReminderRecipients(fixedOwnersRes, profilesRes) {
  const fixedOwnerIds = new Set(
    (fixedOwnersRes.data ?? []).map((s) => s.fixed_user_id)
  )
  const profilesData = profilesRes.data
  if (!profilesData || profilesData.length === 0) return []
  return profilesData.filter((p) => p.email && !fixedOwnerIds.has(p.id))
}

/** Fixed reminder recipient selection. */
function failClosedReminderRecipients(fixedOwnersRes, profilesRes) {
  if (fixedOwnersRes.error) {
    throw new Error(
      `Failed to load fixed-spot owners for reminders: ${fixedOwnersRes.error.message}`
    )
  }
  if (profilesRes.error) {
    throw new Error(
      `Failed to load profiles for reminders: ${profilesRes.error.message}`
    )
  }
  return legacyReminderRecipients(fixedOwnersRes, profilesRes)
}

const userIds = ['u1', 'u2']
const profilesError = {
  data: null,
  error: { message: 'connection reset' },
}
const spotsOk = {
  data: [{ id: 1, label: '1' }],
  error: null,
}
const profilesOk = {
  data: [
    { id: 'u1', email: 'a@example.com' },
    { id: 'u2', email: 'b@example.com' },
  ],
  error: null,
}
const spotsError = {
  data: null,
  error: { message: 'timeout' },
}

// ── Allocation emails ────────────────────────────────────────────────
assert(
  legacyBuildPayloadCount(profilesError, spotsOk, userIds) === 0,
  'legacy path should silently yield 0 payloads on profile error'
)

let threw = false
try {
  failClosedBuildPayloadCount(profilesError, spotsOk, userIds)
} catch (err) {
  threw = /Failed to load profiles for allocation emails/.test(String(err))
}
assert(threw, 'fixed path must throw on profile lookup error')

threw = false
try {
  failClosedBuildPayloadCount(profilesOk, spotsError, userIds)
} catch (err) {
  threw = /Failed to load parking spots for allocation emails/.test(String(err))
}
assert(threw, 'fixed path must throw on spots lookup error')

assert(
  failClosedBuildPayloadCount(profilesOk, spotsOk, userIds) === 2,
  'fixed path still builds payloads when lookups succeed'
)

// ── Registration reminders ───────────────────────────────────────────
const fixedOwnersError = {
  data: null,
  error: { message: 'db unavailable' },
}
const fixedOwnersOk = {
  data: [{ fixed_user_id: 'fixed-1' }],
  error: null,
}
const activeProfiles = {
  data: [
    { id: 'u1', email: 'a@example.com' },
    { id: 'fixed-1', email: 'fixed@example.com' },
  ],
  error: null,
}
const profilesReadError = {
  data: null,
  error: { message: 'permission denied' },
}

// Legacy treats fixed-owner read failure as empty set → fixed owners included.
assert(
  legacyReminderRecipients(fixedOwnersError, activeProfiles).length === 2,
  'legacy reminder path includes fixed owners when fixed-owner lookup fails'
)

threw = false
try {
  failClosedReminderRecipients(fixedOwnersError, activeProfiles)
} catch (err) {
  threw = /Failed to load fixed-spot owners for reminders/.test(String(err))
}
assert(threw, 'fixed reminder path must throw on fixed-owner lookup error')

// Legacy treats profiles read failure as empty → attempted 0 / success.
assert(
  legacyReminderRecipients(fixedOwnersOk, profilesReadError).length === 0,
  'legacy reminder path silently yields 0 recipients on profile error'
)

threw = false
try {
  failClosedReminderRecipients(fixedOwnersOk, profilesReadError)
} catch (err) {
  threw = /Failed to load profiles for reminders/.test(String(err))
}
assert(threw, 'fixed reminder path must throw on profile lookup error')

assert(
  failClosedReminderRecipients(fixedOwnersOk, activeProfiles).length === 1,
  'fixed reminder path still excludes fixed owners when lookups succeed'
)

// ── Source wiring checks ─────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resendSrc = readFileSync(join(root, 'lib/resend.ts'), 'utf8')
const releaseSrc = readFileSync(join(root, 'app/api/release/route.ts'), 'utf8')

assert(
  resendSrc.includes('Failed to load profiles for allocation emails'),
  'lib/resend.ts must fail closed on allocation profile errors'
)
assert(
  resendSrc.includes('Failed to load parking spots for allocation emails'),
  'lib/resend.ts must fail closed on allocation spot errors'
)
assert(
  resendSrc.includes('Failed to load fixed-spot owners for reminders'),
  'lib/resend.ts must fail closed on reminder fixed-owner errors'
)
assert(
  resendSrc.includes('Failed to load profiles for reminders'),
  'lib/resend.ts must fail closed on reminder profile errors'
)
assert(
  releaseSrc.includes('Failed to load promoted user profile for email'),
  'release route must fail closed on promotion profile errors'
)
assert(
  releaseSrc.includes('Failed to load promoted spot for email'),
  'release route must fail closed on promotion spot errors'
)

console.log('OK: email recipient lookup fail-closed behavior verified')
