import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { MAX_DAYS_PER_USER } from '@/lib/constants'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { date, spot_id } = body

    if (!date || spot_id === undefined || spot_id === null) {
      return NextResponse.json({ error: 'Missing date or spot_id' }, { status: 400 })
    }

    if (typeof spot_id !== 'number' || !Number.isInteger(spot_id) || spot_id <= 0) {
      return NextResponse.json({ error: 'Invalid spot_id' }, { status: 400 })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }

    const serviceClient = await createServiceClient()

    // Fetch spot and validate it is claimable
    const { data: spot } = await serviceClient
      .from('parking_spots')
      .select('id, label, is_active, fixed_user_id, reserved_name')
      .eq('id', spot_id)
      .maybeSingle()

    if (!spot) {
      return NextResponse.json({ error: 'Spot not found' }, { status: 404 })
    }

    if (!spot.is_active) {
      return NextResponse.json({ error: 'Spot is not available' }, { status: 409 })
    }

    const isSpot40 = spot.label === '40'
    const isRaissa = user.email?.toLowerCase() === 'raissa.ramos@shieldfc.com'
    const isReservedByFallback = !!spot.reserved_name || isSpot40

    if (spot.fixed_user_id && spot.fixed_user_id !== user.id) {
      return NextResponse.json({ error: 'Spot is reserved' }, { status: 409 })
    }

    if (!spot.fixed_user_id && isReservedByFallback && !(isSpot40 && isRaissa)) {
      return NextResponse.json({ error: 'Spot is reserved' }, { status: 409 })
    }

    const { data: existingAlloc } = await serviceClient
      .from('weekly_allocations')
      .select('id')
      .eq('spot_id', spot_id)
      .eq('date', date)
      .maybeSingle()

    if (existingAlloc) {
      return NextResponse.json({ error: 'Spot is already taken' }, { status: 409 })
    }

    const { data: userAlloc } = await serviceClient
      .from('weekly_allocations')
      .select('id')
      .eq('user_id', user.id)
      .eq('date', date)
      .maybeSingle()

    if (userAlloc) {
      return NextResponse.json({ error: 'You already have a spot for this day' }, { status: 409 })
    }

    // Enforce the weekly cap. Leftover empty spots after allocation must not
    // let a user exceed MAX_DAYS_PER_USER via manual claim.
    const dayDate = parseISO(date)
    const weekStart = format(startOfWeek(dayDate, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd = format(addDays(parseISO(weekStart), 4), 'yyyy-MM-dd')

    const { count: weekDayCount, error: weekCountError } = await serviceClient
      .from('weekly_allocations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('date', weekStart)
      .lte('date', weekEnd)

    if (weekCountError) {
      console.error('Claim week-count lookup failed', weekCountError.message)
      return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
    }

    if ((weekDayCount ?? 0) >= MAX_DAYS_PER_USER) {
      return NextResponse.json(
        { error: `Maximum ${MAX_DAYS_PER_USER} days per week reached` },
        { status: 409 }
      )
    }

    // When a waitlist exists for this date, only the FIFO head may claim an
    // empty spot. Otherwise anyone browsing the grid can jump the queue —
    // a concrete case after allocation leaves leftover spots while users
    // remain waitlisted (e.g. fill-up stopped before MAX_DAYS_PER_USER).
    const { data: waitlistHead, error: waitlistHeadError } = await serviceClient
      .from('waitlist')
      .select('user_id')
      .eq('date', date)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (waitlistHeadError) {
      console.error('Claim waitlist head lookup failed', waitlistHeadError.message)
      return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
    }

    if (waitlistHead && waitlistHead.user_id !== user.id) {
      return NextResponse.json(
        { error: 'This spot is reserved for the waitlist' },
        { status: 409 }
      )
    }

    const { error: insertError } = await serviceClient
      .from('weekly_allocations')
      .insert({
        user_id: user.id,
        spot_id,
        date,
        pass_number: 5,
      })

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'Spot already taken' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
    }

    // Claimant must leave the waitlist in the same logical operation. If this
    // delete fails, release_and_promote can later pick them as FIFO head, hit
    // UNIQUE(user_id, date), and roll back every release for that date.
    const { error: waitlistError } = await serviceClient
      .from('waitlist')
      .delete()
      .eq('user_id', user.id)
      .eq('date', date)

    if (waitlistError) {
      const { error: rollbackError } = await serviceClient
        .from('weekly_allocations')
        .delete()
        .eq('user_id', user.id)
        .eq('spot_id', spot_id)
        .eq('date', date)

      console.error('Claim waitlist cleanup failed', {
        user_id: user.id,
        spot_id,
        date,
        waitlist_error: waitlistError.message,
        rollback_error: rollbackError?.message ?? null,
      })

      return NextResponse.json(
        { error: 'Failed to finalize claim. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Claim error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Claim failed' },
      { status: 500 }
    )
  }
}
