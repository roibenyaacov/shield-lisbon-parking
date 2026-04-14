import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendRegistrationReminders } from '@/lib/resend'
import type { Profile } from '@/types/db'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    const isCronAuthed = !!cronSecret && authHeader === `Bearer ${cronSecret}`

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
    const { sent } = await sendRegistrationReminders(serviceClient)

    return NextResponse.json({ success: true, sent })
  } catch (error) {
    console.error('Reminder error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reminder failed' },
      { status: 500 }
    )
  }
}
