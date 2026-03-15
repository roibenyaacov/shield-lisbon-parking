import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendWaitlistPromotionEmail } from '@/lib/resend'
import type { Profile, ParkingSpot, Waitlist } from '@/types/db'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { date, spot_id, user_id } = await request.json()

    if (!date || !spot_id) {
      return NextResponse.json({ error: 'Missing date or spot_id' }, { status: 400 })
    }

    if (user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const serviceClient = await createServiceClient()

    const { error: deleteError } = await serviceClient
      .from('weekly_allocations')
      .delete()
      .eq('user_id', user.id)
      .eq('date', date)
      .eq('spot_id', spot_id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    const { data: rawWaitlist } = await serviceClient
      .from('waitlist')
      .select('*')
      .eq('date', date)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    const waitlistEntry = rawWaitlist as Waitlist | null

    if (waitlistEntry) {
      const { error: assignError } = await serviceClient
        .from('weekly_allocations')
        .insert({
          user_id: waitlistEntry.user_id,
          spot_id: spot_id,
          date: date,
          pass_number: 4,
        } as any)

      if (!assignError) {
        await serviceClient
          .from('waitlist')
          .delete()
          .eq('id', waitlistEntry.id)

        try {
          const { data: rawProfile } = await serviceClient
            .from('profiles')
            .select('*')
            .eq('id', waitlistEntry.user_id)
            .single()

          const promotedProfile = rawProfile as Profile | null

          const { data: rawSpot } = await serviceClient
            .from('parking_spots')
            .select('*')
            .eq('id', spot_id)
            .single()

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

      return NextResponse.json({
        success: true,
        released: true,
        promoted_user: waitlistEntry.user_id,
      })
    }

    return NextResponse.json({ success: true, released: true, promoted_user: null })
  } catch (error) {
    console.error('Release error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Release failed' },
      { status: 500 }
    )
  }
}
