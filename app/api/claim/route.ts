import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

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

    const { error: insertError } = await serviceClient
      .from('weekly_allocations')
      .insert({
        user_id: user.id,
        spot_id,
        date,
        pass_number: 5,
      })

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    await serviceClient
      .from('waitlist')
      .delete()
      .eq('user_id', user.id)
      .eq('date', date)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Claim error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Claim failed' },
      { status: 500 }
    )
  }
}
