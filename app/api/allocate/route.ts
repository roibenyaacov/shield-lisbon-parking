import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runAllocation, saveAllocations } from '@/lib/allocation'
import { nextMonday, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { sendAllocationEmails } from '@/lib/resend'
import { LISBON_TIMEZONE, ALLOCATION_DAY, ALLOCATION_HOUR } from '@/lib/constants'
import type { Profile } from '@/types/db'

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
    if (nowLisbon.getDay() !== ALLOCATION_DAY || nowLisbon.getHours() !== ALLOCATION_HOUR) {
      return NextResponse.json({
        skipped: true,
        reason:  'Not the target Lisbon hour for allocation',
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

  try {
    await sendAllocationEmails(serviceClient, allocations, waitlisted)
  } catch (emailError) {
    console.error('Email notification error:', emailError)
  }

  return NextResponse.json({
    success:           true,
    week_start:        weekStart,
    allocations_count: allocations.length,
    waitlisted_count:  waitlisted.length,
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
