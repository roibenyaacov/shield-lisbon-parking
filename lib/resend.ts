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

const FROM_EMAIL = 'Shield Parking <parking@shield-parking.com>'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shield-parking.com'
const LOGO_URL = `${BASE_URL}/logo.png`

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
): Promise<void> {
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
  if (allUserIds.size === 0) return

  const [profilesRes, spotsRes] = await Promise.all([
    supabase.from('profiles').select('*').in('id', [...allUserIds]),
    supabase.from('parking_spots').select('*'),
  ])

  const profiles = (profilesRes.data ?? []) as Profile[]
  const spots = (spotsRes.data ?? []) as ParkingSpot[]

  const profileMap = new Map(profiles.map((p) => [p.id, p]))
  const spotMap = new Map(spots.map((s) => [s.id, s]))

  for (const userId of allUserIds) {
    const profile = profileMap.get(userId)
    if (!profile?.email) continue

    const allocs = userAllocations.get(userId) ?? []
    const waitDays = userWaitlist.get(userId) ?? []

    if (allocs.length === 0 && waitDays.length === 0) continue

    const assignments = allocs
      .map((a) => ({
        date: a.date,
        spotLabel: spotMap.get(a.spot_id)?.label ?? '?',
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const sortedWaitDays = [...waitDays].sort()

    const firstDate = assignments[0]?.date ?? sortedWaitDays[0]
    const subject = assignments.length > 0
      ? `🅿️ Parking for Next Week — ${format(new Date(firstDate), 'MMM d')}`
      : `⏳ Waitlisted — Week of ${format(new Date(firstDate), 'MMM d')}`

    try {
      await getResend().emails.send({
        from: FROM_EMAIL,
        to: profile.email,
        subject,
        html: weeklyAllocationHtml(
          profile.full_name ?? 'Team Member',
          assignments,
          sortedWaitDays
        ),
      })
    } catch (err) {
      console.error(`Failed to send allocation email to ${profile.email}:`, err)
    }
  }
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
  supabase: SupabaseClient
): Promise<{ sent: number }> {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true)

  if (!profiles || profiles.length === 0) return { sent: 0 }

  const weekStart = nextMonday(new Date())
  const weekLabel = format(weekStart, 'MMMM d, yyyy')

  let sent = 0
  for (const profile of profiles as Profile[]) {
    if (!profile.email) continue
    try {
      await getResend().emails.send({
        from: FROM_EMAIL,
        to: profile.email,
        subject: `🅿️ Parking Registration Open — Week of ${format(weekStart, 'MMM d')}`,
        html: registrationReminderHtml(
          profile.full_name ?? 'Team Member',
          weekLabel
        ),
      })
      sent++
    } catch (err) {
      console.error(`Failed to send reminder to ${profile.email}:`, err)
    }
  }
  return { sent }
}

export { registrationReminderHtml, weeklyAllocationHtml, waitlistPromotionHtml }

export async function sendWaitlistPromotionEmail(
  email: string,
  name: string,
  spotLabel: string,
  date: string
): Promise<void> {
  try {
    await getResend().emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `🎉 You Got a Spot! — ${format(new Date(date), 'EEEE, MMM d')}`,
      html: waitlistPromotionHtml(name, spotLabel, date),
    })
  } catch (err) {
    console.error(`Failed to send waitlist promotion email to ${email}:`, err)
  }
}
