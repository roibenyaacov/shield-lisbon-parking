import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runAllocation, saveAllocations } from '@/lib/allocation'
import { nextMonday, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { sendAllocationEmails, type EmailSendSummary } from '@/lib/resend'
import { LISBON_TIMEZONE, ALLOCATION_DAY, ALLOCATION_HOUR } from '@/lib/constants'
import type { Profile } from '@/types/db'

async function handleAllocate(request: NextRequest, weekStartOverride?: string) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // !!cronSecret ensures an empty/missing secret never accidentally
  // matches an empty Authorization header.
  const isCronAuthed = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  // ── DST-safe cron guard ────────────────────────────────────────────────
  // GitHub Actions cron runs in UTC and has no timezone support, so we schedule
  // the cron at both 07:00 UTC and 08:00 UTC each Friday.  At least one fires
  // after the Lisbon request window closes at 08:00, even across DST changes.
  // Admin manual triggers (non-cron auth) bypass this so they can re-run anytime.
  if (isCronAuthed) {
    const nowLisbon = toZonedTime(new Date(), LISBON_TIMEZONE)
    const lisbonHour = nowLisbon.getHours()
    // Day guard: only run on Friday.  The lower bound must never be before
    // ALLOCATION_HOUR because request submission remains open until then.
    // The upper bound tolerates delayed GitHub Actions jobs.
    if (
      nowLisbon.getDay() !== ALLOCATION_DAY ||
      lisbonHour < ALLOCATION_HOUR ||
      lisbonHour > 12
    ) {
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
  // A dedicated run marker is safer than inferring completion from an
  // allocation row: some valid weeks can have no Monday allocations, and
  // individual manual claims should never make the cron skip publication.
  const { data: existingRun } = await serviceClient
    .from('allocation_runs')
    .select('week_start')
    .eq('week_start', weekStart)
    .limit(1)
    .maybeSingle()

  if (existingRun) {
    return NextResponse.json({
      success:      true,
      week_start:   weekStart,
      already_run:  true,
      message:      'Allocations already exist for this week.',
    })
  }

  const { allocations, waitlisted } = await runAllocation(serviceClient, weekStart)
  const saved = await saveAllocations(serviceClient, weekStart, allocations, waitlisted)
  if (!saved) {
    return NextResponse.json({
      success:      true,
      week_start:   weekStart,
      already_run:  true,
      message:      'Allocations already exist for this week.',
    })
  }

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
