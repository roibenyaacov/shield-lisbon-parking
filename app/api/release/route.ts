import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendWaitlistPromotionEmail } from '@/lib/resend'
import type { Profile, ParkingSpot } from '@/types/db'
import { format, parseISO, startOfWeek } from 'date-fns'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { date, spot_id, user_id, action } = body

    // ── Input validation ──────────────────────────────────────────────
    if (!date || spot_id === undefined || spot_id === null) {
      return NextResponse.json({ error: 'Missing date or spot_id' }, { status: 400 })
    }

    if (user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (typeof spot_id !== 'number' || !Number.isInteger(spot_id) || spot_id <= 0) {
      return NextResponse.json({ error: 'Invalid spot_id' }, { status: 400 })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }

    if (action !== 'release' && action !== 'reclaim') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
    // ─────────────────────────────────────────────────────────────────

    const serviceClient = await createServiceClient()

    // ── RECLAIM ───────────────────────────────────────────────────────
    if (action === 'reclaim') {
      const { data: fixedSpot } = await serviceClient
        .from('parking_spots')
        .select('id')
        .eq('id', spot_id)
        .eq('fixed_user_id', user.id)
        .single()

      if (!fixedSpot) {
        return NextResponse.json({ error: 'You do not own this fixed spot' }, { status: 403 })
      }

      const { data: existingAlloc } = await serviceClient
        .from('weekly_allocations')
        .select('id')
        .eq('spot_id', spot_id)
        .eq('date', date)
        .maybeSingle()

      if (existingAlloc) {
        return NextResponse.json({ error: 'Spot is already taken for this day' }, { status: 409 })
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

      const { data: reclaimedAlloc, error: insertError } = await serviceClient
        .from('weekly_allocations')
        .insert({
          user_id: user.id,
          spot_id,
          date,
          pass_number: 0,
        })
        .select('id')
        .single()

      if (insertError) {
        if (insertError.code === '23505') {
          return NextResponse.json({ error: 'Spot already taken' }, { status: 409 })
        }
        return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
      }

      const releaseDeleteError = await deleteFixedSpotRelease(
        serviceClient,
        user.id,
        spot_id,
        date
      )

      if (releaseDeleteError) {
        if (reclaimedAlloc?.id) {
          await serviceClient
            .from('weekly_allocations')
            .delete()
            .eq('id', reclaimedAlloc.id)
        }
        return NextResponse.json({ error: releaseDeleteError.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, reclaimed: true })
    }

    // ── RELEASE (atomic via RPC) ──────────────────────────────────────
    const releaseMarker = await recordFixedSpotRelease(serviceClient, user.id, spot_id, date)
    if (releaseMarker.error) {
      return NextResponse.json({ error: releaseMarker.error.message }, { status: 500 })
    }

    const { data: rpcResult, error: rpcError } = await serviceClient
      .rpc('release_and_promote', {
        p_user_id: user.id,
        p_spot_id: spot_id,
        p_date:    date,
      })

    if (rpcError) {
      if (releaseMarker.marked) {
        await deleteFixedSpotRelease(serviceClient, user.id, spot_id, date)
      }
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    const result = rpcResult as {
      released?: boolean
      promoted_user_id?: string | null
      error?: string
    }

    // Fixed spot owner releasing a day that was never explicitly allocated
    // (the spot is in its default "reserved" state with no allocation row).
    // Use the atomic release_fixed_and_promote RPC instead of manual queries.
    if (result.error === 'You do not have this allocation') {
      const { data: fixedRpcResult, error: fixedRpcError } = await serviceClient
        .rpc('release_fixed_and_promote', {
          p_user_id: user.id,
          p_spot_id: spot_id,
          p_date:    date,
        })

      if (fixedRpcError) {
        if (releaseMarker.marked) {
          await deleteFixedSpotRelease(serviceClient, user.id, spot_id, date)
        }
        return NextResponse.json({ error: fixedRpcError.message }, { status: 500 })
      }

      const fixedResult = fixedRpcResult as {
        released?: boolean
        promoted_user_id?: string | null
        error?: string
      }

      if (fixedResult.error) {
        if (releaseMarker.marked) {
          await deleteFixedSpotRelease(serviceClient, user.id, spot_id, date)
        }
        return NextResponse.json({ error: fixedResult.error }, { status: 403 })
      }

      if (fixedResult.promoted_user_id) {
        await sendPromotionEmail(serviceClient, fixedResult.promoted_user_id, spot_id, date)
      }

      return NextResponse.json({
        success: true,
        released: true,
        promoted_user: fixedResult.promoted_user_id ?? null,
      })
    }

    if (result.error) {
      if (releaseMarker.marked) {
        await deleteFixedSpotRelease(serviceClient, user.id, spot_id, date)
      }
      return NextResponse.json({ error: result.error }, { status: 403 })
    }

    // Email is sent outside the DB transaction — a send failure never
    // rolls back the already-committed allocation change.
    if (result.promoted_user_id) {
      await sendPromotionEmail(serviceClient, result.promoted_user_id, spot_id, date)
    }

    return NextResponse.json({
      success: true,
      released: true,
      promoted_user: result.promoted_user_id ?? null,
    })
  } catch (error) {
    console.error('Release error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Release failed' },
      { status: 500 }
    )
  }
}

async function recordFixedSpotRelease(
  serviceClient: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
  spotId: number,
  date: string
): Promise<{ marked: boolean; error: Error | null }> {
  const { data: fixedSpot, error: fixedSpotError } = await serviceClient
    .from('parking_spots')
    .select('id')
    .eq('id', spotId)
    .eq('fixed_user_id', userId)
    .maybeSingle()

  if (fixedSpotError) return { marked: false, error: new Error(fixedSpotError.message) }
  if (!fixedSpot) return { marked: false, error: null }

  const weekStart = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const { error } = await serviceClient
    .from('spot_releases')
    .upsert(
      {
        user_id: userId,
        spot_id: spotId,
        week_start: weekStart,
        date,
      },
      { onConflict: 'user_id,spot_id,date' }
    )

  return { marked: !error, error: error ? new Error(error.message) : null }
}

async function deleteFixedSpotRelease(
  serviceClient: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
  spotId: number,
  date: string
): Promise<Error | null> {
  const { error } = await serviceClient
    .from('spot_releases')
    .delete()
    .eq('user_id', userId)
    .eq('spot_id', spotId)
    .eq('date', date)

  return error ? new Error(error.message) : null
}

async function sendPromotionEmail(
  serviceClient: Awaited<ReturnType<typeof createServiceClient>>,
  promotedUserId: string,
  spotId: number,
  date: string
): Promise<void> {
  try {
    const [{ data: rawProfile }, { data: rawSpot }] = await Promise.all([
      serviceClient.from('profiles').select('*').eq('id', promotedUserId).single(),
      serviceClient.from('parking_spots').select('*').eq('id', spotId).single(),
    ])

    const promotedProfile = rawProfile as Profile | null
    const spot = rawSpot as ParkingSpot | null

    if (promotedProfile?.email && spot) {
      await sendWaitlistPromotionEmail(
        promotedProfile.email,
        promotedProfile.full_name ?? 'User',
        spot.label,
        date
      )
    }
  } catch (emailError) {
    console.error('Waitlist promotion email error:', emailError)
  }
}
