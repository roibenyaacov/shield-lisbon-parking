import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile, ParkingSpot } from '@/types/db'
import { format, nextMonday } from 'date-fns'

let _resend: Resend | null = null

function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

const FROM_EMAIL  = 'Parking App <noreply@smarty-parking-portugal.com>'
const REPLY_TO    = 'parking@shieldfc.com'
const SEND_CONCURRENCY = 5

// Resend's default limit is 10 requests/second.  Five concurrent workers
// finish each send in well under 200ms, so without pacing we blast ~25
// starts into the first second: the first 10 succeed and the rest fail
// with 429.  Production Wednesday reminders have done this every week
// since the concurrency helper landed (25 attempted, 10 sent, 15 failed).
export const RESEND_MIN_INTERVAL_MS = 120
export const RESEND_RATE_LIMIT_COOLDOWN_MS = 1100
export const RESEND_RATE_LIMIT_RETRIES = 4
export const REMINDER_DEDUPE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://smarty-parking-portugal.com'
const LOGO_URL = `${BASE_URL}/logo.png`

// ─── Delivery summary contract returned by every sender ─────────────────
// `attempted` is the number of users we tried to email.
// `sent` / `failed` always sum to `attempted`.
// `errors` carries one entry per failure so cron logs are diagnostic.
// ─────────────────────────────────────────────────────────────────────────
export interface EmailSendError {
  email:   string
  message: string
}

export interface EmailSendSummary {
  attempted: number
  sent:      number
  failed:    number
  errors:    EmailSendError[]
}

export interface SendSlotState {
  nextSlotMs: number
}

export interface SendRegistrationReminderOptions {
  /** Users who already received a successful reminder in this window. */
  skipUserIds?: ReadonlySet<string>
  /** Emails that already received a successful reminder (covers null user_id). */
  skipEmails?: ReadonlySet<string>
}

export function isResendRateLimitError(message: string): boolean {
  return /too many requests|rate limit/i.test(message)
}

/** Space send starts so a rolling 1s window stays under Resend's 10 req/s. */
export function scheduleSendSlot(
  state: SendSlotState,
  nowMs: number,
  minIntervalMs = RESEND_MIN_INTERVAL_MS
): { waitMs: number; nextState: SendSlotState } {
  const slotMs = Math.max(nowMs, state.nextSlotMs)
  return {
    waitMs: slotMs - nowMs,
    nextState: { nextSlotMs: slotMs + minIntervalMs },
  }
}

/** After a 429, push the next start past the current 1s rate-limit window. */
export function applyRateLimitCooldown(
  state: SendSlotState,
  nowMs: number,
  cooldownMs = RESEND_RATE_LIMIT_COOLDOWN_MS
): SendSlotState {
  return { nextSlotMs: Math.max(state.nextSlotMs, nowMs + cooldownMs) }
}

export function isReminderEmailDeliveryIncomplete(summary: EmailSendSummary): boolean {
  return summary.failed > 0
}

let sendSlotState: SendSlotState = { nextSlotMs: 0 }

async function waitForSendSlot(): Promise<void> {
  const scheduled = scheduleSendSlot(sendSlotState, Date.now())
  sendSlotState = scheduled.nextState
  if (scheduled.waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, scheduled.waitMs))
  }
}

function noteRateLimited(): void {
  sendSlotState = applyRateLimitCooldown(sendSlotState, Date.now())
}

async function sendResendEmail(params: {
  to:      string
  subject: string
  html:    string
}): Promise<{ messageId: string | null }> {
  let lastMessage = 'unknown send error'
  for (let attempt = 0; attempt <= RESEND_RATE_LIMIT_RETRIES; attempt++) {
    await waitForSendSlot()
    const res = await getResend().emails.send({
      from:    FROM_EMAIL,
      replyTo: REPLY_TO,
      to:      params.to,
      subject: params.subject,
      html:    params.html,
    })
    if (!res.error) {
      return { messageId: res.data?.id ?? null }
    }
    lastMessage = res.error.message
    if (!isResendRateLimitError(lastMessage) || attempt === RESEND_RATE_LIMIT_RETRIES) {
      throw new Error(lastMessage)
    }
    noteRateLimited()
  }
  throw new Error(lastMessage)
}

/**
 * Users (and emails) with a successful `reminder` email_log row in the last
 * 5 days.  Used so a 500-driven cron retry does not re-send to the 10 people
 * who already got through the rate limit.  A missing `email_log` table
 * returns empty sets so we still attempt delivery.
 */
export async function getUsersWithSentReminderEmails(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<{ userIds: Set<string>; emails: Set<string> }> {
  const windowStart = new Date(now.getTime() - REMINDER_DEDUPE_WINDOW_MS).toISOString()

  const { data, error } = await supabase
    .from('email_log')
    .select('user_id, email')
    .eq('type', 'reminder')
    .eq('status', 'sent')
    .gte('created_at', windowStart)

  if (error) {
    console.error('email_log lookup for reminder dedupe failed (non-fatal):', error.message)
    return { userIds: new Set(), emails: new Set() }
  }

  const userIds = new Set<string>()
  const emails = new Set<string>()
  for (const row of data ?? []) {
    const typed = row as { user_id: string | null; email: string | null }
    if (typed.user_id) userIds.add(typed.user_id)
    if (typed.email) emails.add(typed.email.toLowerCase())
  }
  return { userIds, emails }
}

// Bounded-concurrency map: never starts more than `concurrency` promises at
// once.  Order of results matches order of `items`.  Never rejects — each
// slot is wrapped in a settled result so the caller sees per-item outcomes.
async function mapWithConcurrency<T, R>(
  items:       T[],
  concurrency: number,
  fn:          (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      try {
        const value = await fn(items[idx])
        results[idx] = { status: 'fulfilled', value }
      } catch (reason) {
        results[idx] = { status: 'rejected', reason }
      }
    }
  })

  await Promise.all(workers)
  return results
}

// Best-effort persistence to the email_log table.  Never throws — a
// logging failure must never break the send pipeline.  Safe to call even
// if migration 013 has not yet been applied (the catch will swallow the
// "relation does not exist" error and console.error it).
async function logEmail(
  supabase: SupabaseClient,
  entry: {
    user_id:              string | null
    email:                string
    type:                 string
    status:               'sent' | 'failed'
    error?:               string | null
    provider_message_id?: string | null
    sent_at?:             string | null
  }
): Promise<void> {
  try {
    const { error } = await supabase.from('email_log').insert({
      user_id:             entry.user_id,
      email:               entry.email,
      type:                entry.type,
      status:              entry.status,
      error:               entry.error               ?? null,
      provider_message_id: entry.provider_message_id ?? null,
      sent_at:             entry.sent_at             ?? null,
    } as never)
    if (error) {
      console.error('email_log insert failed (non-fatal):', error.message)
    }
  } catch (err) {
    console.error('email_log insert threw (non-fatal):', err)
  }
}

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text',system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2F2F7;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding:32px 32px 16px;text-align:center;">
              <img src="${LOGO_URL}" alt="Shield" width="140" style="display:inline-block;height:auto;" />
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;text-align:center;border-top:1px solid #F2F2F7;">
              <p style="margin:16px 0 0;color:#C7C7CC;font-size:11px;">Shield &middot; Lisbon, Portugal</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function weeklyAllocationHtml(
  name: string,
  assignments: { date: string; spotLabel: string }[],
  waitlistedDays: string[]
): string {
  const hasSpots = assignments.length > 0
  const hasWaitlist = waitlistedDays.length > 0

  const spotRows = assignments
    .map(
      (a) =>
        `<tr>
          <td style="padding:14px 16px;border-bottom:1px solid #F0F0F5;font-size:14px;color:#1a1a1a;">${format(new Date(a.date), 'EEEE, MMM d')}</td>
          <td style="padding:14px 16px;border-bottom:1px solid #F0F0F5;text-align:right;">
            <span style="display:inline-block;background:#2563EB;color:#FFFFFF;font-size:13px;font-weight:700;padding:6px 14px;border-radius:20px;">${a.spotLabel}</span>
          </td>
        </tr>`
    )
    .join('')

  const waitlistRows = waitlistedDays
    .map(
      (d) =>
        `<tr>
          <td style="padding:14px 16px;border-bottom:1px solid #F0F0F5;font-size:14px;color:#1a1a1a;">${format(new Date(d), 'EEEE, MMM d')}</td>
          <td style="padding:14px 16px;border-bottom:1px solid #F0F0F5;text-align:right;">
            <span style="display:inline-block;background:#FFF7ED;border:1px solid #FED7AA;color:#C2410C;font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;">Waitlist</span>
          </td>
        </tr>`
    )
    .join('')

  const title = hasSpots
    ? 'Your Parking for Next Week'
    : 'You&rsquo;re on the Waitlist'


  const spotsSection = hasSpots
    ? `<div style="background:#F0F0FF;border:2px solid #D4D4FF;border-radius:16px;overflow:hidden;margin:0 0 20px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:#6366F1;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Day</th>
              <th style="padding:12px 16px;text-align:right;font-size:11px;color:#6366F1;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Your Spot</th>
            </tr>
          </thead>
          <tbody style="background:#FFFFFF;">${spotRows}</tbody>
        </table>
      </div>`
    : ''

  const waitlistSection = hasWaitlist
    ? `${hasSpots ? '<p style="margin:0 0 12px;color:#8E8E93;font-size:14px;line-height:1.5;">You&rsquo;re on the waitlist for these days:</p>' : '<p style="margin:0 0 12px;color:#8E8E93;font-size:14px;line-height:1.5;">You&rsquo;ve been placed on the waitlist for:</p>'}
      <div style="background:#FFF7ED;border:2px solid #FED7AA;border-radius:16px;overflow:hidden;margin:0 0 20px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:#C2410C;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Day</th>
              <th style="padding:12px 16px;text-align:right;font-size:11px;color:#C2410C;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Status</th>
            </tr>
          </thead>
          <tbody style="background:#FFFFFF;">${waitlistRows}</tbody>
        </table>
      </div>
      <div style="background:#F0F0FF;border:2px solid #D4D4FF;border-radius:16px;padding:16px 20px;margin:0 0 20px;">
        <p style="margin:0;color:#3C3C43;font-size:13px;line-height:1.6;text-align:center;">
          If someone releases their spot, you&rsquo;ll be <strong>automatically assigned</strong> and notified by email.
        </p>
      </div>`
    : ''

  return emailWrapper(`
    <h2 style="margin:0 0 24px;color:#1a1a1a;font-size:22px;font-weight:700;text-align:center;">${title}</h2>

    <p style="margin:0 0 20px;color:#3C3C43;font-size:15px;">Hi ${name},</p>

    ${hasSpots ? '<p style="margin:0 0 16px;color:#8E8E93;font-size:14px;line-height:1.5;">Here are your parking allocations:</p>' : ''}

    ${spotsSection}
    ${waitlistSection}

    <a href="${BASE_URL}/dashboard" style="display:block;background:#2563EB;color:#FFFFFF;text-decoration:none;text-align:center;padding:14px 24px;border-radius:14px;font-size:15px;font-weight:600;margin:0 0 20px;">View in App</a>

    <p style="margin:0;color:#AEAEB2;font-size:12px;text-align:center;line-height:1.5;">
      Can&rsquo;t make it? Release your spot in the app so someone else can use it.
    </p>
  `)
}

function waitlistPromotionHtml(name: string, spotLabel: string, date: string): string {
  return emailWrapper(`
    <h2 style="margin:0 0 4px;color:#1a1a1a;font-size:22px;font-weight:700;text-align:center;">A Spot Opened Up!</h2>
    <p style="margin:0 0 24px;color:#8E8E93;font-size:14px;text-align:center;">You&rsquo;ve been moved from the waitlist</p>

    <p style="margin:0 0 20px;color:#3C3C43;font-size:15px;">Hi ${name},</p>

    <p style="margin:0 0 20px;color:#8E8E93;font-size:14px;line-height:1.5;">Someone released their parking spot and it&rsquo;s now yours:</p>

    <div style="background:#F0F0FF;border:2px solid #D4D4FF;border-radius:16px;padding:24px;text-align:center;margin:0 0 8px;">
      <p style="margin:0 0 6px;color:#6366F1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Your Spot</p>
      <p style="margin:0;font-size:36px;font-weight:700;color:#1a1a1a;letter-spacing:2px;">${spotLabel}</p>
    </div>

    <p style="margin:0 0 24px;color:#8E8E93;font-size:14px;text-align:center;">
      ${format(new Date(date), 'EEEE, MMMM d, yyyy')}
    </p>

    <a href="${BASE_URL}/dashboard" style="display:block;background:#2563EB;color:#FFFFFF;text-decoration:none;text-align:center;padding:14px 24px;border-radius:14px;font-size:15px;font-weight:600;margin:0 0 20px;">View in App</a>

    <p style="margin:0;color:#AEAEB2;font-size:12px;text-align:center;line-height:1.5;">
      This was assigned automatically from the waitlist. Enjoy your parking!
    </p>
  `)
}

export async function sendAllocationEmails(
  supabase: SupabaseClient,
  allocations: { user_id: string; spot_id: number; date: string; pass_number: number }[],
  waitlisted: { user_id: string; date: string }[]
): Promise<EmailSendSummary> {
  const summary: EmailSendSummary = { attempted: 0, sent: 0, failed: 0, errors: [] }

  const userAllocations = new Map<string, { date: string; spot_id: number }[]>()
  for (const alloc of allocations) {
    if (alloc.pass_number === 0) continue
    const list = userAllocations.get(alloc.user_id) ?? []
    list.push({ date: alloc.date, spot_id: alloc.spot_id })
    userAllocations.set(alloc.user_id, list)
  }

  const userWaitlist = new Map<string, string[]>()
  for (const w of waitlisted) {
    const list = userWaitlist.get(w.user_id) ?? []
    list.push(w.date)
    userWaitlist.set(w.user_id, list)
  }

  const allUserIds = new Set([...userAllocations.keys(), ...userWaitlist.keys()])
  if (allUserIds.size === 0) return summary

  const [profilesRes, spotsRes] = await Promise.all([
    supabase.from('profiles').select('*').in('id', [...allUserIds]),
    supabase.from('parking_spots').select('*'),
  ])

  const profiles = (profilesRes.data ?? []) as Profile[]
  const spots    = (spotsRes.data    ?? []) as ParkingSpot[]

  const profileMap = new Map(profiles.map((p) => [p.id, p]))
  const spotMap    = new Map(spots.map((s) => [s.id, s]))

  // Build one self-contained payload per user, then dispatch with
  // bounded concurrency plus global start-spacing.  Spacing keeps us
  // under Resend's 10 req/s default; 429s retry after a cooldown so a
  // single rate-limit response does not drop the rest of the batch.
  interface Payload {
    profile:       Profile
    assignments:   { date: string; spotLabel: string }[]
    waitDays:      string[]
    subject:       string
  }

  const payloads: Payload[] = []
  for (const userId of allUserIds) {
    const profile = profileMap.get(userId)
    if (!profile?.email) continue

    const allocs   = userAllocations.get(userId) ?? []
    const waitDays = userWaitlist.get(userId)    ?? []
    if (allocs.length === 0 && waitDays.length === 0) continue

    const assignments = allocs
      .map((a) => ({
        date:      a.date,
        spotLabel: spotMap.get(a.spot_id)?.label ?? '?',
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const sortedWaitDays = [...waitDays].sort()
    const firstDate = assignments[0]?.date ?? sortedWaitDays[0]
    const subject   = assignments.length > 0
      ? `🅿️ Parking for Next Week — ${format(new Date(firstDate), 'MMM d')}`
      : `⏳ Waitlisted — Week of ${format(new Date(firstDate), 'MMM d')}`

    payloads.push({ profile, assignments, waitDays: sortedWaitDays, subject })
  }

  summary.attempted = payloads.length
  if (payloads.length === 0) return summary

  const results = await mapWithConcurrency(payloads, SEND_CONCURRENCY, async (p) => {
    return sendResendEmail({
      to:      p.profile.email!,
      subject: p.subject,
      html:    weeklyAllocationHtml(
        p.profile.full_name ?? 'Team Member',
        p.assignments,
        p.waitDays
      ),
    })
  })

  const now = new Date().toISOString()
  for (let i = 0; i < results.length; i++) {
    const p = payloads[i]
    const r = results[i]
    if (r.status === 'fulfilled') {
      summary.sent++
      await logEmail(supabase, {
        user_id:             p.profile.id,
        email:               p.profile.email!,
        type:                'allocation',
        status:              'sent',
        provider_message_id: r.value.messageId,
        sent_at:             now,
      })
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      summary.failed++
      summary.errors.push({ email: p.profile.email!, message: msg })
      console.error(`Failed to send allocation email to ${p.profile.email}:`, msg)
      await logEmail(supabase, {
        user_id: p.profile.id,
        email:   p.profile.email!,
        type:    'allocation',
        status:  'failed',
        error:   msg,
      })
    }
  }

  return summary
}

function registrationReminderHtml(name: string, weekLabel: string): string {
  return emailWrapper(`
    <h2 style="margin:0 0 4px;color:#1a1a1a;font-size:22px;font-weight:700;text-align:center;">Parking Registration Is Open</h2>
    <p style="margin:0 0 24px;color:#8E8E93;font-size:14px;text-align:center;">Week of ${weekLabel}</p>

    <p style="margin:0 0 20px;color:#3C3C43;font-size:15px;">Hi ${name},</p>

    <p style="margin:0 0 20px;color:#8E8E93;font-size:14px;line-height:1.6;">
      The parking registration window is now open. Select the days you need parking for next week.
    </p>

    <div style="background:#F0F0FF;border:2px solid #D4D4FF;border-radius:16px;padding:20px 24px;margin:0 0 20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;color:#6366F1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Opens</td>
          <td style="padding:8px 0;color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;">Wednesday, 19:00</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6366F1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #E0E0FF;">Closes</td>
          <td style="padding:8px 0;color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;border-top:1px solid #E0E0FF;">Friday, 08:00</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6366F1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #E0E0FF;">Max Days</td>
          <td style="padding:8px 0;color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;border-top:1px solid #E0E0FF;">4 per week</td>
        </tr>
      </table>
    </div>

    <a href="${BASE_URL}/dashboard" style="display:block;background:#2563EB;color:#FFFFFF;text-decoration:none;text-align:center;padding:14px 24px;border-radius:14px;font-size:15px;font-weight:600;margin:0 0 20px;">Register Now</a>

    <p style="margin:0;color:#AEAEB2;font-size:12px;text-align:center;line-height:1.5;">
      Allocations are published every Friday at 08:00 (Lisbon time).
    </p>
  `)
}

export async function sendRegistrationReminders(
  supabase: SupabaseClient,
  options: SendRegistrationReminderOptions = {}
): Promise<EmailSendSummary> {
  const summary: EmailSendSummary = { attempted: 0, sent: 0, failed: 0, errors: [] }
  const skipUserIds = options.skipUserIds
  const skipEmails  = options.skipEmails

  // Exclude fixed-spot holders — their spot is auto-assigned and they
  // don't need to register during the Wed–Fri window.
  const { data: fixedOwners } = await supabase
    .from('parking_spots')
    .select('fixed_user_id')
    .not('fixed_user_id', 'is', null)

  const fixedOwnerIds = new Set(
    (fixedOwners ?? []).map((s: { fixed_user_id: string }) => s.fixed_user_id)
  )

  const { data: profilesData } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true)

  if (!profilesData || profilesData.length === 0) return summary

  const weekStart = nextMonday(new Date())
  const weekLabel = format(weekStart, 'MMMM d, yyyy')

  const recipients = (profilesData as Profile[]).filter((p) => {
    if (!p.email || fixedOwnerIds.has(p.id)) return false
    if (skipUserIds?.has(p.id)) return false
    if (skipEmails?.has(p.email.toLowerCase())) return false
    return true
  })

  summary.attempted = recipients.length
  if (recipients.length === 0) return summary

  const results = await mapWithConcurrency(recipients, SEND_CONCURRENCY, async (profile) => {
    return sendResendEmail({
      to:      profile.email!,
      subject: `🅿️ Parking Registration Open — Week of ${format(weekStart, 'MMM d')}`,
      html:    registrationReminderHtml(
        profile.full_name ?? 'Team Member',
        weekLabel
      ),
    })
  })

  const now = new Date().toISOString()
  for (let i = 0; i < results.length; i++) {
    const profile = recipients[i]
    const r       = results[i]
    if (r.status === 'fulfilled') {
      summary.sent++
      await logEmail(supabase, {
        user_id:             profile.id,
        email:               profile.email!,
        type:                'reminder',
        status:              'sent',
        provider_message_id: r.value.messageId,
        sent_at:             now,
      })
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      summary.failed++
      summary.errors.push({ email: profile.email!, message: msg })
      console.error(`Failed to send reminder to ${profile.email}:`, msg)
      await logEmail(supabase, {
        user_id: profile.id,
        email:   profile.email!,
        type:    'reminder',
        status:  'failed',
        error:   msg,
      })
    }
  }

  return summary
}

export { registrationReminderHtml, weeklyAllocationHtml, waitlistPromotionHtml }

export async function sendWaitlistPromotionEmail(
  supabase: SupabaseClient,
  userId:   string | null,
  email:    string,
  name:     string,
  spotLabel: string,
  date:     string
): Promise<EmailSendSummary> {
  const summary: EmailSendSummary = { attempted: 1, sent: 0, failed: 0, errors: [] }

  try {
    const sent = await sendResendEmail({
      to:      email,
      subject: `🎉 You Got a Spot! — ${format(new Date(date), 'EEEE, MMM d')}`,
      html:    waitlistPromotionHtml(name, spotLabel, date),
    })

    summary.sent = 1
    await logEmail(supabase, {
      user_id:             userId,
      email,
      type:                'waitlist-promotion',
      status:              'sent',
      provider_message_id: sent.messageId,
      sent_at:             new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    summary.failed = 1
    summary.errors.push({ email, message: msg })
    console.error(`Failed to send waitlist promotion email to ${email}:`, msg)
    await logEmail(supabase, {
      user_id: userId,
      email,
      type:    'waitlist-promotion',
      status:  'failed',
      error:   msg,
    })
  }

  return summary
}

// Sender for the /api/email-preview admin test endpoint.  Kept here so
// it shares the same FROM/replyTo conventions and the same email_log
// pipeline as production sends.
export async function sendTestEmail(
  supabase: SupabaseClient,
  userId:   string | null,
  opts: { to: string; subject: string; html: string; type: string }
): Promise<EmailSendSummary> {
  const summary: EmailSendSummary = { attempted: 1, sent: 0, failed: 0, errors: [] }

  try {
    const sent = await sendResendEmail({
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
    })

    summary.sent = 1
    await logEmail(supabase, {
      user_id:             userId,
      email:               opts.to,
      type:                `test:${opts.type}`,
      status:              'sent',
      provider_message_id: sent.messageId,
      sent_at:             new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    summary.failed = 1
    summary.errors.push({ email: opts.to, message: msg })
    console.error(`Failed to send test email to ${opts.to}:`, msg)
    await logEmail(supabase, {
      user_id: userId,
      email:   opts.to,
      type:    `test:${opts.type}`,
      status:  'failed',
      error:   msg,
    })
  }

  return summary
}
