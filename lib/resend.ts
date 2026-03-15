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

const FROM_EMAIL = 'Shield Parking <parking@shield.ai>'

function spotConfirmedHtml(
  name: string,
  assignments: { date: string; spotLabel: string }[]
): string {
  const rows = assignments
    .map(
      (a) =>
        `<tr>
          <td style="padding:8px 16px;border-bottom:1px solid #eee;font-size:14px;color:#334155;">${format(new Date(a.date), 'EEEE, MMM d')}</td>
          <td style="padding:8px 16px;border-bottom:1px solid #eee;font-size:14px;color:#334155;font-weight:600;">Spot #${a.spotLabel}</td>
        </tr>`
    )
    .join('')

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:#2C3E50;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;font-size:20px;margin:0;">Shield Lisbon Parking</h1>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
        <p style="font-size:16px;color:#1e293b;margin:0 0 8px;">Hi ${name},</p>
        <p style="font-size:14px;color:#64748b;margin:0 0 20px;">Your parking spots for next week have been confirmed:</p>
        <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:8px 16px;text-align:left;font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;">Day</th>
              <th style="padding:8px 16px;text-align:left;font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;">Spot</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="font-size:12px;color:#94a3b8;margin:20px 0 0;text-align:center;">
          If you can't make it, please release your spot in the app so someone else can use it.
        </p>
      </div>
    </div>
  `
}

function waitlistUpdateHtml(name: string, spotLabel: string, date: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:#2C3E50;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;font-size:20px;margin:0;">Shield Lisbon Parking</h1>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
        <p style="font-size:16px;color:#1e293b;margin:0 0 8px;">Hi ${name},</p>
        <p style="font-size:14px;color:#64748b;margin:0 0 20px;">Great news! A parking spot just opened up for you:</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;text-align:center;margin:0 0 20px;">
          <p style="font-size:14px;color:#166534;margin:0 0 4px;font-weight:600;">
            Spot #${spotLabel}
          </p>
          <p style="font-size:13px;color:#15803d;margin:0;">
            ${format(new Date(date), 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
        <p style="font-size:12px;color:#94a3b8;margin:0;text-align:center;">
          You've been automatically moved from the waitlist. Enjoy your parking!
        </p>
      </div>
    </div>
  `
}

export async function sendAllocationEmails(
  supabase: SupabaseClient,
  allocations: { user_id: string; spot_id: number; date: string; pass_number: number }[],
  waitlisted: { user_id: string; date: string }[]
): Promise<void> {
  const userAllocations = new Map<string, { date: string; spot_id: number }[]>()
  for (const alloc of allocations) {
    const list = userAllocations.get(alloc.user_id) ?? []
    list.push({ date: alloc.date, spot_id: alloc.spot_id })
    userAllocations.set(alloc.user_id, list)
  }

  const userIds = [...userAllocations.keys()]
  if (userIds.length === 0) return

  const [profilesRes, spotsRes] = await Promise.all([
    supabase.from('profiles').select('*').in('id', userIds),
    supabase.from('parking_spots').select('*'),
  ])

  const profiles = (profilesRes.data ?? []) as Profile[]
  const spots = (spotsRes.data ?? []) as ParkingSpot[]

  const profileMap = new Map(profiles.map((p) => [p.id, p]))
  const spotMap = new Map(spots.map((s) => [s.id, s]))

  for (const [userId, allocs] of userAllocations) {
    const profile = profileMap.get(userId)
    if (!profile?.email) continue

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
        subject: `Parking Confirmed — Week of ${format(new Date(assignments[0].date), 'MMM d')}`,
        html: spotConfirmedHtml(profile.full_name ?? 'Team Member', assignments),
      })
    } catch (err) {
      console.error(`Failed to send email to ${profile.email}:`, err)
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
    subject: `Parking Spot Available — ${format(new Date(date), 'EEEE, MMM d')}`,
    html: waitlistUpdateHtml(name, spotLabel, date),
  })
}
