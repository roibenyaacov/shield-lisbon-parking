import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { toZonedTime } from 'date-fns-tz'
import { sendRegistrationReminders } from '@/lib/resend'
import { LISBON_TIMEZONE } from '@/lib/constants'
import { isReminderCronWindow } from '@/lib/reminder-window'
import type { Profile } from '@/types/db'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    const isCronAuthed = !!cronSecret && authHeader === `Bearer ${cronSecret}`

    // ── Cron guard ───────────────────────────────────────────────────────
    // One Wednesday 17:00 UTC schedule. GitHub often starts it hours later.
    // Accept Wednesday 15:00 through all of Thursday (Lisbon): a start after
    // midnight is still inside the registration window. Admin cookie
    // triggers bypass this guard.
    if (isCronAuthed) {
      const nowLisbon = toZonedTime(new Date(), LISBON_TIMEZONE)
      if (!isReminderCronWindow(nowLisbon)) {
        return NextResponse.json({
          skipped: true,
          reason:  'Not the target Lisbon window for reminders',
          lisbon_day:  nowLisbon.getDay(),
          lisbon_hour: nowLisbon.getHours(),
        })
      }
    }

    if (!isCronAuthed) {
      const userClient = await createClient()
      const { data: { user } } = await userClient.auth.getUser()

      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { data: rawProfile } = await userClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      const profile = rawProfile as Profile | null
      if (!profile || profile.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const serviceClient = await createServiceClient()
    const emailSummary  = await sendRegistrationReminders(serviceClient)

    return NextResponse.json({
      success:       true,
      sent:          emailSummary.sent,
      email_summary: emailSummary,
    })
  } catch (error) {
    console.error('Reminder error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reminder failed' },
      { status: 500 }
    )
  }
}
