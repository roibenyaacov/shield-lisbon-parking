import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runAllocation, saveAllocations } from '@/lib/allocation'
import { nextMonday, format } from 'date-fns'
import { sendAllocationEmails } from '@/lib/resend'
import type { Profile } from '@/types/db'

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const body = await request.json().catch(() => ({}))

    const cronSecret = process.env.CRON_SECRET
    const isCronAuthed = cronSecret && authHeader === `Bearer ${cronSecret}`

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

    const weekStart = body.week_start ?? format(nextMonday(new Date()), 'yyyy-MM-dd')

    const { allocations, waitlisted } = await runAllocation(serviceClient, weekStart)
    await saveAllocations(serviceClient, weekStart, allocations, waitlisted)

    try {
      await sendAllocationEmails(serviceClient, allocations, waitlisted)
    } catch (emailError) {
      console.error('Email notification error:', emailError)
    }

    return NextResponse.json({
      success: true,
      week_start: weekStart,
      allocations_count: allocations.length,
      waitlisted_count: waitlisted.length,
    })
  } catch (error) {
    console.error('Allocation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Allocation failed' },
      { status: 500 }
    )
  }
}
