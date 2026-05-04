import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { toZonedTime } from 'date-fns-tz'
import { nextMonday, format } from 'date-fns'
import { LISBON_TIMEZONE, REQUEST_OPEN_DAY, REQUEST_OPEN_HOUR, MAX_DAYS_PER_USER } from '@/lib/constants'

// Mirrors the client-side getFormState() logic but runs on the server
// so it cannot be bypassed by editing the browser JS.
function isWindowOpen(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return true

  const now = toZonedTime(new Date(), LISBON_TIMEZONE)
  const day  = now.getDay()
  const hour = now.getHours()

  if (day === REQUEST_OPEN_DAY && hour >= REQUEST_OPEN_HOUR) return true // Wed 19:00+
  if (day === 4) return true                                              // Thursday all day
  if (day === 5 && hour < 8) return true                                 // Friday before 08:00
  return false
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Time window gate ──────────────────────────────────────────────
    if (!isWindowOpen()) {
      return NextResponse.json(
        { error: 'Registration window is closed. Opens Wednesday at 19:00 Lisbon time.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { week_start, mon, tue, wed, thu, fri } = body

    // ── week_start must equal the upcoming Monday (Lisbon time) ───────
    const nowLisbon        = toZonedTime(new Date(), LISBON_TIMEZONE)
    const expectedWeekStart = format(nextMonday(nowLisbon), 'yyyy-MM-dd')

    if (week_start !== expectedWeekStart) {
      return NextResponse.json(
        { error: 'Invalid week_start. Must be the upcoming Monday.' },
        { status: 400 }
      )
    }

    // ── Day count validation ──────────────────────────────────────────
    const selectedCount = [mon, tue, wed, thu, fri].filter(Boolean).length
    if (selectedCount === 0) {
      return NextResponse.json({ error: 'Select at least one day.' }, { status: 400 })
    }
    if (selectedCount > MAX_DAYS_PER_USER) {
      return NextResponse.json({ error: `Maximum ${MAX_DAYS_PER_USER} days per week.` }, { status: 400 })
    }

    // ── Upsert via service client (bypasses RLS for the write) ────────
    // user.id is taken from the verified session — never from the request body.
    const serviceClient = await createServiceClient()
    const { error: upsertError } = await serviceClient
      .from('weekly_requests')
      .upsert(
        {
          user_id:    user.id,
          week_start,
          mon: !!mon,
          tue: !!tue,
          wed: !!wed,
          thu: !!thu,
          fri: !!fri,
        },
        { onConflict: 'user_id,week_start' }
      )

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Request submission error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Submission failed' },
      { status: 500 }
    )
  }
}
