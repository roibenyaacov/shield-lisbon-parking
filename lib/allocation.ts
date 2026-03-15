import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile, ParkingSpot, WeeklyRequest, WeeklyAllocationInsert, WaitlistInsert } from '@/types/db'
import { TEAM_DAY_MAP, DAY_NAMES, DAY_KEYS, MAX_DAYS_PER_USER } from '@/lib/constants'
import { addDays, format } from 'date-fns'

interface AllocationEntry {
  user_id: string
  spot_id: number
  date: string
  pass_number: number
}

interface UserDayRequest {
  userId: string
  profile: Profile
  requestedAt: string
  isTeamDay: boolean
}

function pickSpot(
  availableSpots: ParkingSpot[],
  vehicleType: string | null
): ParkingSpot | null {
  if (availableSpots.length === 0) return null

  if (vehicleType === 'electric') {
    const evSpot = availableSpots.find((s) => s.priority === 'ev')
    if (evSpot) return evSpot
  }

  if (vehicleType === 'motorcycle') {
    const motoSpot = availableSpots.find((s) => s.priority === 'motorcycle')
    if (motoSpot) return motoSpot
  }

  const sorted = [...availableSpots].sort((a, b) => {
    if (a.priority === 'general' && b.priority !== 'general') return -1
    if (a.priority !== 'general' && b.priority === 'general') return 1
    return parseInt(a.label) - parseInt(b.label)
  })

  return sorted[0]
}

export async function runAllocation(
  supabase: SupabaseClient,
  weekStart: string
): Promise<{ allocations: AllocationEntry[]; waitlisted: { user_id: string; date: string }[] }> {
  const [spotsRes, requestsRes, profilesRes, releasesRes] = await Promise.all([
    supabase.from('parking_spots').select('*').eq('is_active', true),
    supabase.from('weekly_requests').select('*').eq('week_start', weekStart),
    supabase.from('profiles').select('*').eq('is_active', true),
    supabase.from('spot_releases').select('*').eq('week_start', weekStart),
  ])

  const spots = (spotsRes.data ?? []) as ParkingSpot[]
  const requests = (requestsRes.data ?? []) as WeeklyRequest[]
  const profiles = (profilesRes.data ?? []) as Profile[]
  const releases = (releasesRes.data ?? []) as { user_id: string }[]

  const profileMap = new Map(profiles.map((p) => [p.id, p]))
  const releasedUserIds = new Set(releases.map((r) => r.user_id))

  const userDayCount = new Map<string, number>()
  const allAllocations: AllocationEntry[] = []
  const allWaitlisted: { user_id: string; date: string }[] = []
  const spotOccupied = new Map<string, Set<number>>()

  for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
    const dayName = DAY_NAMES[dayIndex]
    const dayKey = DAY_KEYS[dayIndex]
    const dateStr = format(addDays(new Date(weekStart), dayIndex), 'yyyy-MM-dd')

    if (!spotOccupied.has(dateStr)) {
      spotOccupied.set(dateStr, new Set())
    }
    const occupiedToday = spotOccupied.get(dateStr)!

    const fixedSpots = spots.filter((s) => s.fixed_user_id)
    for (const spot of fixedSpots) {
      if (!releasedUserIds.has(spot.fixed_user_id!)) {
        occupiedToday.add(spot.id)
        allAllocations.push({
          user_id: spot.fixed_user_id!,
          spot_id: spot.id,
          date: dateStr,
          pass_number: 0,
        })
        userDayCount.set(
          spot.fixed_user_id!,
          (userDayCount.get(spot.fixed_user_id!) ?? 0) + 1
        )
      }
    }

    const teamsToday = TEAM_DAY_MAP[dayName] ?? []
    const dayRequests: UserDayRequest[] = []

    for (const req of requests) {
      if (!req[dayKey]) continue
      const profile = profileMap.get(req.user_id)
      if (!profile) continue
      const hasFixedSpot = fixedSpots.some((s) => s.fixed_user_id === req.user_id)
      if (hasFixedSpot && !releasedUserIds.has(req.user_id)) continue

      dayRequests.push({
        userId: req.user_id,
        profile,
        requestedAt: req.created_at,
        isTeamDay: profile.team ? teamsToday.includes(profile.team) : false,
      })
    }

    const teamDayUsers = dayRequests
      .filter((r) => r.isTeamDay)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))

    const otherUsers = dayRequests
      .filter((r) => !r.isTeamDay)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))

    const getAvailable = () =>
      spots.filter((s) => s.is_active && !occupiedToday.has(s.id))

    const assign = (user: UserDayRequest, passNumber: number): boolean => {
      const available = getAvailable()
      const spot = pickSpot(available, user.profile.vehicle_type)
      if (!spot) return false
      occupiedToday.add(spot.id)
      allAllocations.push({
        user_id: user.userId,
        spot_id: spot.id,
        date: dateStr,
        pass_number: passNumber,
      })
      userDayCount.set(user.userId, (userDayCount.get(user.userId) ?? 0) + 1)
      return true
    }

    // PASS 1: Team-day users get 1st spot
    const pass1Assigned = new Set<string>()
    for (const user of teamDayUsers) {
      if ((userDayCount.get(user.userId) ?? 0) >= 1) continue
      if (assign(user, 1)) {
        pass1Assigned.add(user.userId)
      }
    }

    // PASS 2: Remaining users get 1st spot by FCFS
    const pass2Assigned = new Set<string>()
    for (const user of otherUsers) {
      if ((userDayCount.get(user.userId) ?? 0) >= 1) continue
      if (pass1Assigned.has(user.userId)) continue
      if (assign(user, 2)) {
        pass2Assigned.add(user.userId)
      }
    }

    for (const user of teamDayUsers) {
      if (pass1Assigned.has(user.userId)) continue
      if ((userDayCount.get(user.userId) ?? 0) >= 1) continue
      if (assign(user, 2)) {
        pass2Assigned.add(user.userId)
      }
    }

    // PASS 3a: 2nd day assignments
    for (const user of [...teamDayUsers, ...otherUsers]) {
      const count = userDayCount.get(user.userId) ?? 0
      if (count !== 1) continue
      assign(user, 3)
    }

    // Equity check before 3rd day
    const anyWithZero = dayRequests.some(
      (u) => (userDayCount.get(u.userId) ?? 0) === 0
    )

    // PASS 3b: 3rd day (only if equitable)
    if (!anyWithZero) {
      for (const user of [...teamDayUsers, ...otherUsers]) {
        const count = userDayCount.get(user.userId) ?? 0
        if (count !== 2) continue
        if (count + 1 > MAX_DAYS_PER_USER) continue
        assign(user, 3)
      }
    }

    const allocatedToday = new Set(
      allAllocations.filter((a) => a.date === dateStr).map((a) => a.user_id)
    )
    for (const user of dayRequests) {
      if (!allocatedToday.has(user.userId)) {
        allWaitlisted.push({ user_id: user.userId, date: dateStr })
      }
    }
  }

  return { allocations: allAllocations, waitlisted: allWaitlisted }
}

export async function saveAllocations(
  supabase: SupabaseClient,
  weekStart: string,
  allocations: AllocationEntry[],
  waitlisted: { user_id: string; date: string }[]
): Promise<void> {
  const weekDates = Array.from({ length: 5 }, (_, i) =>
    format(addDays(new Date(weekStart), i), 'yyyy-MM-dd')
  )

  for (const date of weekDates) {
    await supabase.from('weekly_allocations').delete().eq('date', date)
    await supabase.from('waitlist').delete().eq('date', date)
  }

  if (allocations.length > 0) {
    const { error } = await supabase
      .from('weekly_allocations')
      .insert(allocations as any)
    if (error) throw new Error(`Failed to insert allocations: ${error.message}`)
  }

  if (waitlisted.length > 0) {
    const { error } = await supabase
      .from('waitlist')
      .insert(waitlisted as any)
    if (error) throw new Error(`Failed to insert waitlist: ${error.message}`)
  }
}
