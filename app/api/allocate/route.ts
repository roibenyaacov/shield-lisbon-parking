import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  loadWeekAllocationResults,
  runAllocation,
  saveAllocations,
  type AllocationEntry,
} from '@/lib/allocation'
import { nextMonday, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import {
  getUsersWithSentAllocationEmails,
  hasEmailableAllocationRecipients,
  isAllocationEmailDeliveryIncomplete,
  sendAllocationEmails,
  type EmailSendSummary,
} from '@/lib/resend'
import { LISBON_TIMEZONE, ALLOCATION_DAY } from '@/lib/constants'
import type { Profile } from '@/types/db'

async function sendWeekAllocationEmails(
  serviceClient: Awaited<ReturnType<typeof createServiceClient>>,
  weekStart: string,
  allocations: AllocationEntry[],
  waitlisted: { user_id: string; date: string }[]
): Promise<{ emailSummary: EmailSendSummary | null; emailError: string | null }> {
  let emailSummary: EmailSendSummary | null = null
  let emailError: string | null = null

  try {
    const skipUserIds = await getUsersWithSentAllocationEmails(serviceClient, weekStart)
    emailSummary = await sendAllocationEmails(
      serviceClient,
      allocations,
      waitlisted,
      { skipUserIds }
    )
  } catch (err) {
    emailError = err instanceof Error ? err.message : 'unknown email error'
    console.error('Email notification error:', err)
  }

  return { emailSummary, emailError }
}

async function handleAllocate(request: NextRequest, weekStartOverride?: string) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // !!cronSecret ensures an empty/missing secret never accidentally
  // matches an empty Authorization header.
  const isCronAuthed = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  // ── DST-safe cron guard ────────────────────────────────────────────────
  // Vercel cron runs in UTC and has no timezone support, so we schedule
  // the cron at BOTH 07:00 UTC and 08:00 UTC each Friday.  Exactly one of
  // those fires at 08:00 Lisbon time depending on whether DST is active.
  // This guard ignores the run unless the current Lisbon time matches the
  // target (Friday 08:00).  Admin manual triggers (non-cron auth) bypass
  // this so they can re-run anytime.
  if (isCronAuthed) {
    const nowLisbon = toZonedTime(new Date(), LISBON_TIMEZONE)
    const lisbonHour = nowLisbon.getHours()
    // Day guard: only run on Friday.
    // Hour guard is intentionally broad (6-12) to tolerate GitHub
    // Actions cron delays of up to several hours.  The idempotency
    // guard further down (`existingAlloc` check) prevents duplicate
    // allocations if the endpoint is called more than once.
    if (
      nowLisbon.getDay() !== ALLOCATION_DAY ||
      lisbonHour < 6 ||
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
  // Check specifically for the first day of the target week.  Checking
  // the full range (gte weekStart, lte weekEnd) is too broad: a manually
  // created allocation for any mid-week date would silently skip the
  // entire allocation run.  Checking only weekStart means a stray
  // mid-week row doesn't block the cron.
  //
  // If rows already exist we still attempt allocation emails for anyone
  // who has not yet received a successful `allocation` email_log entry.
  // Otherwise a save that succeeded before a timeout / Resend outage would
  // permanently strand the org with no notices (`already_run` used to
  // return before sendAllocationEmails).
  const { data: existingAlloc } = await serviceClient
    .from('weekly_allocations')
    .select('id')
    .eq('date', weekStart)
    .limit(1)
    .maybeSingle()

  if (existingAlloc) {
    const persisted = await loadWeekAllocationResults(serviceClient, weekStart)
    const { emailSummary, emailError } = await sendWeekAllocationEmails(
      serviceClient,
      weekStart,
      persisted.allocations,
      persisted.waitlisted
    )

    const emailable = hasEmailableAllocationRecipients(persisted.allocations, persisted.waitlisted)
    const body = {
      success:     true,
      week_start:  weekStart,
      already_run: true,
      message:     'Allocations already exist for this week.',
      email_summary: emailSummary,
      email_error:   emailError,
      email_retried: true,
    }

    if (isAllocationEmailDeliveryIncomplete(emailable, emailSummary, emailError)) {
      return NextResponse.json(body, { status: 500 })
    }

    return NextResponse.json(body)
  }

  const { allocations, waitlisted } = await runAllocation(serviceClient, weekStart)
  await saveAllocations(serviceClient, weekStart, allocations, waitlisted)

  // Per-user send errors are already captured inside the summary and
  // never reach this catch.  This try/catch only fires if the function
  // itself throws before it can return a summary (e.g. profiles fetch
  // failed).  Allocation rows stay persisted either way; a later
  // already_run invocation retries remaining emails.
  const { emailSummary, emailError } = await sendWeekAllocationEmails(
    serviceClient,
    weekStart,
    allocations,
    waitlisted
  )

  const emailable = hasEmailableAllocationRecipients(allocations, waitlisted)
  const body = {
    success:           true,
    week_start:        weekStart,
    allocations_count: allocations.length,
    waitlisted_count:  waitlisted.length,
    email_summary:     emailSummary,
    email_error:       emailError,
  }

  // Surface email failure to cron (HTTP >= 400) so ops re-run can hit the
  // already_run email retry path above.
  if (isAllocationEmailDeliveryIncomplete(emailable, emailSummary, emailError)) {
    return NextResponse.json(body, { status: 500 })
  }

  return NextResponse.json(body)
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
