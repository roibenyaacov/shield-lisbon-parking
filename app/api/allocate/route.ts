import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runAllocation, saveAllocations } from '@/lib/allocation'
import { nextMonday, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { sendAllocationEmails, type EmailSendSummary } from '@/lib/resend'
import { LISBON_TIMEZONE, ALLOCATION_DAY } from '@/lib/constants'
import { isCronAllocationWindow } from '@/lib/cron-window'
import type { Profile } from '@/types/db'

async function handleAllocate(request: NextRequest, weekStartOverride?: string) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // !!cronSecret ensures an empty/missing secret never accidentally
  // matches an empty Authorization header.
  const isCronAuthed = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  // ── Cron guard ─────────────────────────────────────────────────────────
  // The Friday job is scheduled at 07:00 UTC (08:00 Lisbon in summer,
  // 07:00 Lisbon in winter). GitHub Actions often starts it hours later.
  // Accept the rest of Friday Lisbon so a late start still publishes the
  // week. Admin cookie triggers bypass this and can re-run anytime.
  if (isCronAuthed) {
    const nowLisbon = toZonedTime(new Date(), LISBON_TIMEZONE)
    const lisbonHour = nowLisbon.getHours()
    // Friday only, from 06:00 Lisbon through the rest of that Friday.
    // No upper hour bound: GitHub Actions has started this job at Lisbon
    // hour 13 and hour 20, and `hour > 12` skipped those runs so the week
    // was never published. The Monday-row idempotency check below stops a
    // second call from rebuilding an already published week.
    if (!isCronAllocationWindow(nowLisbon.getDay(), lisbonHour, ALLOCATION_DAY)) {
      return NextResponse.json({
        skipped: true,
        reason:  'Not the target Lisbon window for allocation',
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

  // ── Validate week_start if provided ──────────────────────────────────
  if (weekStartOverride !== undefined) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(weekStartOverride) ||
      isNaN(new Date(weekStartOverride).getTime())
    ) {
      return NextResponse.json(
        { error: 'Invalid week_start. Expected YYYY-MM-DD.' },
        { status: 400 }
      )
    }
  }

  const serviceClient = await createServiceClient()
  const weekStart = weekStartOverride ?? format(nextMonday(new Date()), 'yyyy-MM-dd')

  // ── Idempotency guard ─────────────────────────────────────────────────
  // Check specifically for the first day of the target week.  Checking
  // the full range (gte weekStart, lte weekEnd) is too broad: a manually
  // created allocation for any mid-week date would silently skip the
  // entire allocation run.  Checking only weekStart means a stray
  // mid-week row doesn't block the cron.
  const { data: existingAlloc } = await serviceClient
    .from('weekly_allocations')
    .select('id')
    .eq('date', weekStart)
    .limit(1)
    .maybeSingle()

  if (existingAlloc) {
    return NextResponse.json({
      success:      true,
      week_start:   weekStart,
      already_run:  true,
      message:      'Allocations already exist for this week.',
    })
  }

  const { allocations, waitlisted } = await runAllocation(serviceClient, weekStart)
  await saveAllocations(serviceClient, weekStart, allocations, waitlisted)

  // Per-user send errors are already captured inside the summary and
  // never reach this catch.  This try/catch only fires if the function
  // itself throws before it can return a summary (e.g. profiles fetch
  // failed).  In that case we still return success: true for the
  // allocation persistence and surface the error in email_error.
  let emailSummary: EmailSendSummary | null = null
  let emailError:   string | null            = null
  try {
    emailSummary = await sendAllocationEmails(serviceClient, allocations, waitlisted)
  } catch (err) {
    emailError = err instanceof Error ? err.message : 'unknown email error'
    console.error('Email notification error:', err)
  }

  return NextResponse.json({
    success:           true,
    week_start:        weekStart,
    allocations_count: allocations.length,
    waitlisted_count:  waitlisted.length,
    email_summary:     emailSummary,
    email_error:       emailError,
  })
}

export async function GET(request: NextRequest) {
  try {
    return await handleAllocate(request)
  } catch (error) {
    console.error('Allocation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Allocation failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    return await handleAllocate(request, body.week_start)
  } catch (error) {
    console.error('Allocation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Allocation failed' },
      { status: 500 }
    )
  }
}
