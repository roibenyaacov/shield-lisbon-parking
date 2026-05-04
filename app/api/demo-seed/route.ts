import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { addDays, format, startOfWeek, addWeeks } from 'date-fns'

const DEMO_USERS = [
  { email: 'maria.silva@shield-demo.com',     full_name: 'Maria Silva',      team: 'cs',           vehicle_type: 'car' },
  { email: 'joao.costa@shield-demo.com',      full_name: 'João Costa',       team: 'cloudops',     vehicle_type: 'electric' },
  { email: 'ana.pereira@shield-demo.com',     full_name: 'Ana Pereira',      team: 'pm',           vehicle_type: 'car' },
  { email: 'pedro.santos@shield-demo.com',    full_name: 'Pedro Santos',     team: 'sm',           vehicle_type: 'motorcycle' },
  { email: 'sofia.gomes@shield-demo.com',     full_name: 'Sofia Gomes',      team: 'marketing',    vehicle_type: 'car' },
  { email: 'rui.almeida@shield-demo.com',     full_name: 'Rui Almeida',      team: 'data_sources', vehicle_type: 'car' },
  { email: 'ines.martins@shield-demo.com',    full_name: 'Inês Martins',     team: 'devops',       vehicle_type: 'electric' },
  { email: 'tiago.fernandes@shield-demo.com', full_name: 'Tiago Fernandes',  team: 'app_team',     vehicle_type: 'car' },
  { email: 'beatriz.reis@shield-demo.com',    full_name: 'Beatriz Reis',     team: 'hr',           vehicle_type: 'car' },
] as const

function isAuthorized(request: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true
  const url = new URL(request.url)
  if (url.searchParams.get('secret') === secret) return true
  return false
}

async function ensureDemoUsers(supabase: Awaited<ReturnType<typeof createServiceClient>>) {
  const ids: { id: string; email: string; full_name: string; team: string }[] = []

  for (const u of DEMO_USERS) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', u.email)
      .maybeSingle()

    let id: string | null = existing?.id ?? null

    if (!id) {
      const { data: created, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: 'demo-password-shield-2026',
        email_confirm: true,
        user_metadata: {
          full_name: u.full_name,
          team: u.team,
          vehicle_type: u.vehicle_type,
        },
      })
      if (error || !created.user) {
        console.error('createUser failed for', u.email, error)
        continue
      }
      id = created.user.id
    }

    await supabase.from('profiles').upsert(
      {
        id,
        email: u.email,
        full_name: u.full_name,
        team: u.team as never,
        vehicle_type: u.vehicle_type as never,
        is_active: true,
      },
      { onConflict: 'id' }
    )

    ids.push({ id, email: u.email, full_name: u.full_name, team: u.team })
  }

  return ids
}

function buildWeekDates(weeks: number[]): string[] {
  const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
  const dates: string[] = []
  for (const offset of weeks) {
    const w = addWeeks(monday, offset)
    for (let i = 0; i < 5; i++) dates.push(format(addDays(w, i), 'yyyy-MM-dd'))
  }
  return dates
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const promoteSelf = url.searchParams.get('promote_self') === 'true'

  const supabase = await createServiceClient()

  const demoIds = await ensureDemoUsers(supabase)

  const { data: spotsData } = await supabase
    .from('parking_spots')
    .select('*')
    .eq('is_active', true)
    .order('label')

  const spots = spotsData ?? []
  if (spots.length === 0) {
    return NextResponse.json({ error: 'No active parking spots found' }, { status: 500 })
  }

  const spot40 = spots.find((s) => s.label === '40')
  if (spot40) {
    await supabase
      .from('parking_spots')
      .update({ reserved_name: 'Raíssa Ramos' })
      .eq('id', spot40.id)
  }

  const allocatableSpots = spots.filter((s) => s.label !== '40')

  const dates = buildWeekDates([0, 1])

  await supabase
    .from('weekly_allocations')
    .delete()
    .in('user_id', demoIds.map((u) => u.id))

  const allocs: { user_id: string; spot_id: number; date: string; pass_number: number }[] = []
  const PER_DAY = 3
  for (let dayIdx = 0; dayIdx < dates.length; dayIdx++) {
    const date = dates[dayIdx]
    const limit = Math.min(PER_DAY, allocatableSpots.length, demoIds.length)
    for (let i = 0; i < limit; i++) {
      const userIdx = (dayIdx + i) % demoIds.length
      const spotIdx = i
      allocs.push({
        user_id: demoIds[userIdx].id,
        spot_id: allocatableSpots[spotIdx].id,
        date,
        pass_number: 1,
      })
    }
  }

  let allocationsInserted = 0
  if (allocs.length > 0) {
    const { error: insertError, data: inserted } = await supabase
      .from('weekly_allocations')
      .insert(allocs)
      .select('id')
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
    allocationsInserted = inserted?.length ?? 0
  }

  const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
  const nextWeekStart = format(addWeeks(monday, 1), 'yyyy-MM-dd')

  await supabase
    .from('weekly_requests')
    .delete()
    .in('user_id', demoIds.map((u) => u.id))

  const requests = demoIds.map((u, idx) => ({
    user_id: u.id,
    week_start: nextWeekStart,
    mon: idx % 2 === 0,
    tue: idx % 3 !== 0,
    wed: true,
    thu: idx % 2 === 1,
    fri: idx % 4 === 0,
  }))
  if (requests.length > 0) {
    await supabase.from('weekly_requests').insert(requests)
  }

  let promotedAllocations = 0
  if (promoteSelf) {
    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()
    if (user) {
      const nextWeekDates = buildWeekDates([1])
      const targetDates = nextWeekDates.slice(0, 3)
      const promotionAllocs = targetDates.map((date, i) => ({
        user_id: user.id,
        spot_id: allocatableSpots[i + 4]?.id ?? allocatableSpots[0].id,
        date,
        pass_number: 1,
      }))
      await supabase
        .from('weekly_allocations')
        .delete()
        .eq('user_id', user.id)
        .in('date', nextWeekDates)
      const { data: ins } = await supabase
        .from('weekly_allocations')
        .insert(promotionAllocs)
        .select('id')
      promotedAllocations = ins?.length ?? 0
    }
  }

  return NextResponse.json({
    success: true,
    demo_users: demoIds.length,
    allocations_inserted: allocationsInserted,
    requests_inserted: requests.length,
    promoted_allocations: promotedAllocations,
    spot_40_reserved_to: 'Raíssa Ramos',
    week_dates: dates,
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
