import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendWaitlistPromotionEmail } from '@/lib/resend'
import type { Profile, ParkingSpot } from '@/types/db'

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
      const { data: reclaimRpcResult, error: reclaimRpcError } = await serviceClient
        .rpc('reclaim_fixed_spot', {
          p_user_id: user.id,
          p_spot_id: spot_id,
          p_date:    date,
        })

      if (reclaimRpcError) {
        return NextResponse.json({ error: reclaimRpcError.message }, { status: 500 })
      }

      const reclaimResult = reclaimRpcResult as {
        reclaimed?: boolean
        error?: string
      }

      if (reclaimResult.error) {
        const status = reclaimResult.error.includes('already') ? 409 : 403
        return NextResponse.json({ error: reclaimResult.error }, { status })
      }

      return NextResponse.json({ success: true, reclaimed: true })
    }

    // ── RELEASE (atomic via RPC) ──────────────────────────────────────
    const { data: rpcResult, error: rpcError } = await serviceClient
      .rpc('release_and_promote', {
        p_user_id: user.id,
        p_spot_id: spot_id,
        p_date:    date,
      })

    if (rpcError) {
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
        return NextResponse.json({ error: fixedRpcError.message }, { status: 500 })
      }

      const fixedResult = fixedRpcResult as {
        released?: boolean
        promoted_user_id?: string | null
        error?: string
      }

      if (fixedResult.error) {
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
        serviceClient,
        promotedProfile.id,
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
