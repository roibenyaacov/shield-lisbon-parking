import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { toZonedTime } from 'date-fns-tz'
import {
  getUsersWithSentReminderEmails,
  isReminderEmailDeliveryIncomplete,
  sendRegistrationReminders,
} from '@/lib/resend'
import { LISBON_TIMEZONE, REQUEST_OPEN_DAY } from '@/lib/constants'
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
      // Day guard: only run on Wednesday.
      // Hour guard is intentionally broad (15-23) to tolerate GitHub
      // Actions cron delays of up to several hours.  The reminder is
      // naturally idempotent — an extra send is harmless.
      if (
        nowLisbon.getDay() !== REQUEST_OPEN_DAY ||
        lisbonHour < 15 ||
        lisbonHour > 23
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
    const alreadySent   = await getUsersWithSentReminderEmails(serviceClient)
    const emailSummary  = await sendRegistrationReminders(serviceClient, {
      skipUserIds: alreadySent.userIds,
      skipEmails:  alreadySent.emails,
    })

    // Partial Resend 429s used to return HTTP 200 (`success: true`, sent: 10,
    // failed: 15), so GitHub Actions marked the cron green and never retried.
    // Fail the request when anyone is still undelivered so a re-run can
    // finish the rest (already-sent recipients are skipped above).
    if (isReminderEmailDeliveryIncomplete(emailSummary)) {
      return NextResponse.json(
        {
          success:       false,
          sent:          emailSummary.sent,
          skipped:       alreadySent.userIds.size,
          email_summary: emailSummary,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success:       true,
      sent:          emailSummary.sent,
      skipped:       alreadySent.userIds.size,
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
