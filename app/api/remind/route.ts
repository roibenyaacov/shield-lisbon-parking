import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { toZonedTime } from 'date-fns-tz'
import { sendRegistrationReminders } from '@/lib/resend'
import { LISBON_TIMEZONE, REQUEST_OPEN_DAY, REQUEST_OPEN_HOUR } from '@/lib/constants'
import type { Profile } from '@/types/db'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    const isCronAuthed = !!cronSecret && authHeader === `Bearer ${cronSecret}`

    // ── DST-safe cron guard ──────────────────────────────────────────────
    // Vercel cron runs in UTC.  We schedule both 18:00 UTC and 19:00 UTC
    // each Wednesday — exactly one matches 19:00 Lisbon depending on DST.
    // Skip the run if Lisbon time isn't the target (Wed 19:00).  Admin
    // manual triggers bypass the guard.
    if (isCronAuthed) {
      const nowLisbon  = toZonedTime(new Date(), LISBON_TIMEZONE)
      const lisbonHour = nowLisbon.getHours()
      // The paired UTC schedules cover Lisbon DST. Only the invocation
      // that lands exactly at the configured local hour may send.
      if (
        nowLisbon.getDay() !== REQUEST_OPEN_DAY ||
        lisbonHour !== REQUEST_OPEN_HOUR
      ) {
        return NextResponse.json({
          skipped: true,
          reason:  'Not the target Lisbon window for reminders',
          lisbon_day:  nowLisbon.getDay(),
          lisbon_hour: lisbonHour,
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
