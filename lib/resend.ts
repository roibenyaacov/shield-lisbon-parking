import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile, ParkingSpot } from '@/types/db'
import { format } from 'date-fns'

let _resend: Resend | null = null

function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

const FROM_EMAIL = 'Shield Parking <parking@shield-parking.com>'

const LOGO_URL = 'https://shield-parking.com/logo.png'

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text',system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2F2F7;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -2px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2C3E50 100%);padding:28px 32px;text-align:center;">
              <img src="${LOGO_URL}" alt="Shield" width="120" style="display:inline-block;height:auto;margin-bottom:8px;" />
              <p style="margin:0;color:rgba(255,255,255,0.7);font-size:13px;font-weight:500;letter-spacing:0.5px;">Lisbon Office Parking</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:0 32px 24px;text-align:center;border-top:1px solid #F2F2F7;">
              <p style="margin:16px 0 0;color:#C7C7CC;font-size:11px;">Shield &middot; Lisbon, Portugal</p>
              <p style="margin:4px 0 0;color:#D1D1D6;font-size:10px;">Automated message, please don&rsquo;t reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function spotConfirmedHtml(
  name: string,
  assignments: { date: string; spotLabel: string }[]
): string {
  const rows = assignments
    .map(
      (a) =>
        `<tr>
          <td style="padding:12px 16px;border-bottom:1px solid #F2F2F7;font-size:14px;color:#1a1a1a;">${format(new Date(a.date), 'EEEE, MMM d')}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #F2F2F7;font-size:14px;color:#1a1a1a;font-weight:700;text-align:right;">Spot #${a.spotLabel}</td>
        </tr>`
    )
    .join('')

  return emailWrapper(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:32px;margin-bottom:8px;">🎉</div>
      <h2 style="margin:0 0 4px;color:#1a1a1a;font-size:22px;font-weight:700;">You Got a Spot!</h2>
      <p style="margin:0;color:#8E8E93;font-size:14px;">Your parking for next week is confirmed</p>
    </div>

    <p style="margin:0 0 20px;color:#3C3C43;font-size:15px;">Hi ${name},</p>

    <p style="margin:0 0 16px;color:#8E8E93;font-size:14px;line-height:1.5;">Great news! Your parking spots have been allocated. Here are your assignments:</p>

    <table style="width:100%;border-collapse:collapse;background:#F8F9FA;border-radius:16px;overflow:hidden;margin:0 0 20px;">
      <thead>
        <tr style="background:#EEF2FF;">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#6366F1;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Day</th>
          <th style="padding:10px 16px;text-align:right;font-size:11px;color:#6366F1;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Spot</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <a href="https://shield-parking.com/dashboard" style="display:block;background:#2563EB;color:#FFFFFF;text-decoration:none;text-align:center;padding:14px 24px;border-radius:14px;font-size:15px;font-weight:600;margin:0 0 20px;">Open in app</a>

    <p style="margin:0;color:#AEAEB2;font-size:12px;text-align:center;line-height:1.5;">
      If you can&rsquo;t make it, please release your spot in the app so someone else can use it.
    </p>
  `)
}

function waitlistUpdateHtml(name: string, spotLabel: string, date: string): string {
  return emailWrapper(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:32px;margin-bottom:8px;">🎉</div>
      <h2 style="margin:0 0 4px;color:#1a1a1a;font-size:22px;font-weight:700;">You Got a Spot!</h2>
      <p style="margin:0;color:#8E8E93;font-size:14px;">A spot just opened up for you</p>
    </div>

    <p style="margin:0 0 20px;color:#3C3C43;font-size:15px;">Hi ${name},</p>

    <p style="margin:0 0 20px;color:#8E8E93;font-size:14px;line-height:1.5;">Great news! A parking spot has been allocated to you from the waitlist. Your booking is confirmed.</p>

    <!-- Spot Badge -->
    <div style="background:#EEF2FF;border:2px solid #C7D2FE;border-radius:20px;padding:20px;text-align:center;margin:0 0 16px;">
      <p style="margin:0;color:#2563EB;font-size:28px;font-weight:800;letter-spacing:1px;">Spot ${spotLabel}</p>
    </div>

    <p style="margin:0 0 24px;color:#3C3C43;font-size:14px;">
      <strong style="color:#1a1a1a;">Date:</strong> ${format(new Date(date), 'EEEE, MMMM d, yyyy')}
    </p>

    <a href="https://shield-parking.com/dashboard" style="display:block;background:#2563EB;color:#FFFFFF;text-decoration:none;text-align:center;padding:14px 24px;border-radius:14px;font-size:15px;font-weight:600;margin:0 0 20px;">Open in app</a>

    <p style="margin:0;color:#AEAEB2;font-size:12px;text-align:center;line-height:1.5;">
      You&rsquo;ve been automatically moved from the waitlist. Enjoy your parking!
    </p>
  `)
}

function noSpotsHtml(name: string, waitlistedDays: string[]): string {
  const daysList = waitlistedDays
    .map(d => `<li style="padding:6px 0;color:#3C3C43;font-size:14px;">${format(new Date(d), 'EEEE, MMM d')}</li>`)
    .join('')

  return emailWrapper(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:32px;margin-bottom:8px;">⏳</div>
      <h2 style="margin:0 0 4px;color:#1a1a1a;font-size:22px;font-weight:700;">You're on the Waitlist</h2>
      <p style="margin:0;color:#8E8E93;font-size:14px;">All spots are taken, but don't worry</p>
    </div>

    <p style="margin:0 0 20px;color:#3C3C43;font-size:15px;">Hi ${name},</p>

    <p style="margin:0 0 16px;color:#8E8E93;font-size:14px;line-height:1.5;">Unfortunately, all parking spots have been allocated this week. You've been placed on the waitlist for:</p>

    <ul style="margin:0 0 20px;padding-left:20px;background:#FFF7ED;border-radius:16px;padding:16px 16px 16px 36px;">${daysList}</ul>

    <p style="margin:0 0 20px;color:#8E8E93;font-size:14px;line-height:1.5;">If someone releases their spot, you'll be automatically assigned and notified by email.</p>

    <a href="https://shield-parking.com/dashboard" style="display:block;background:#2563EB;color:#FFFFFF;text-decoration:none;text-align:center;padding:14px 24px;border-radius:14px;font-size:15px;font-weight:600;margin:0 0 20px;">Open in app</a>
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

    const allocs = userAllocations.get(userId)
    const waitDays = userWaitlist.get(userId)

    if (allocs && allocs.length > 0) {
      const assignments = allocs
        .map((a) => ({
          date: a.date,
          spotLabel: spotMap.get(a.spot_id)?.label ?? '?',
        }))
        .sort((a, b) => a.date.localeCompare(b.date))

      try {
        await getResend().emails.send({
          from: FROM_EMAIL,
          to: profile.email,
          subject: `🅿️ Parking Confirmed — Week of ${format(new Date(assignments[0].date), 'MMM d')}`,
          html: spotConfirmedHtml(profile.full_name ?? 'Team Member', assignments),
        })
      } catch (err) {
        console.error(`Failed to send allocation email to ${profile.email}:`, err)
      }
    } else if (waitDays && waitDays.length > 0) {
      const sortedDays = [...waitDays].sort()
      try {
        await getResend().emails.send({
          from: FROM_EMAIL,
          to: profile.email,
          subject: `⏳ Waitlisted — Week of ${format(new Date(sortedDays[0]), 'MMM d')}`,
          html: noSpotsHtml(profile.full_name ?? 'Team Member', sortedDays),
        })
      } catch (err) {
        console.error(`Failed to send waitlist email to ${profile.email}:`, err)
      }
    }
  }
}

export async function sendWaitlistPromotionEmail(
  email: string,
  name: string,
  spotLabel: string,
  date: string
): Promise<void> {
  await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `🎉 You Got a Spot! — ${format(new Date(date), 'EEEE, MMM d')}`,
    html: waitlistUpdateHtml(name, spotLabel, date),
  })
}
