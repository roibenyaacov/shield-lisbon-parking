import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile, ParkingSpot, WeeklyRequest, WeeklyAllocationInsert, WaitlistInsert } from '@/types/db'
import { TEAM_DAY_MAP, DAY_NAMES, DAY_KEYS, MAX_DAYS_PER_USER } from '@/lib/constants'
import { addDays, format, parseISO } from 'date-fns'

export interface AllocationEntry {
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
    const dateStr = format(addDays(parseISO(weekStart), dayIndex), 'yyyy-MM-dd')

    if (!spotOccupied.has(dateStr)) {
      spotOccupied.set(dateStr, new Set())
    }
    const occupiedToday = spotOccupied.get(dateStr)!

    // Users who already hold a spot on this date.  `userDayCount` counts
    // days across the whole week and therefore cannot answer "does this
    // user already have a spot today?" — without this set, passes 3a/3b
    // hand a second (and third) spot for the same day to a user who was
    // already served in pass 1/2, which violates UNIQUE(user_id, date).
    const assignedToday = new Set<string>()

    const fixedSpots = spots.filter((s) => s.fixed_user_id)
    for (const spot of fixedSpots) {
      if (!releasedUserIds.has(spot.fixed_user_id!)) {
        occupiedToday.add(spot.id)
        assignedToday.add(spot.fixed_user_id!)
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
      if (assignedToday.has(user.userId)) return false
      const available = getAvailable()
      const spot = pickSpot(available, user.profile.vehicle_type)
      if (!spot) return false
      occupiedToday.add(spot.id)
      assignedToday.add(user.userId)
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

    for (const user of dayRequests) {
      if (!assignedToday.has(user.userId)) {
        allWaitlisted.push({ user_id: user.userId, date: dateStr })
      }
    }
  }

  return { allocations: allAllocations, waitlisted: allWaitlisted }
}

/** Monday–Friday dates for a parking week starting on `weekStart`. */
export function weekDatesFor(weekStart: string): string[] {
  return Array.from({ length: 5 }, (_, i) =>
    format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd')
  )
}

/**
 * Load persisted allocation + waitlist rows for a week so callers (e.g.
 * `/api/allocate` `already_run` retries) can resend notification emails
 * without re-running the allocator.
 */
export async function loadWeekAllocationResults(
  supabase: SupabaseClient,
  weekStart: string
): Promise<{
  allocations: AllocationEntry[]
  waitlisted: { user_id: string; date: string }[]
}> {
  const weekDates = weekDatesFor(weekStart)

  const [allocsRes, waitRes] = await Promise.all([
    supabase
      .from('weekly_allocations')
      .select('user_id, spot_id, date, pass_number')
      .in('date', weekDates),
    supabase
      .from('waitlist')
      .select('user_id, date')
      .in('date', weekDates),
  ])

  if (allocsRes.error) {
    throw new Error(`Failed to load week allocations: ${allocsRes.error.message}`)
  }
  if (waitRes.error) {
    throw new Error(`Failed to load week waitlist: ${waitRes.error.message}`)
  }

  return {
    allocations: (allocsRes.data ?? []) as AllocationEntry[],
    waitlisted: (waitRes.data ?? []) as { user_id: string; date: string }[],
  }
}

export async function saveAllocations(
  supabase: SupabaseClient,
  weekStart: string,
  allocations: AllocationEntry[],
  waitlisted: { user_id: string; date: string }[]
): Promise<void> {
  const weekDates = weekDatesFor(weekStart)

  // Validate before the destructive delete below.  The delete and insert
  // are not in a transaction, so an insert that trips UNIQUE(user_id,
  // date) or UNIQUE(spot_id, date) would leave the week with no
  // allocations at all.  Failing here keeps the previous rows intact.
  const seenUserDate = new Set<string>()
  const seenSpotDate = new Set<string>()
  for (const a of allocations) {
    const userKey = `${a.user_id}|${a.date}`
    if (seenUserDate.has(userKey)) {
      throw new Error(`Allocation conflict: user ${a.user_id} assigned twice on ${a.date}`)
    }
    seenUserDate.add(userKey)

    const spotKey = `${a.spot_id}|${a.date}`
    if (seenSpotDate.has(spotKey)) {
      throw new Error(`Allocation conflict: spot ${a.spot_id} assigned twice on ${a.date}`)
    }
    seenSpotDate.add(spotKey)
  }

  for (const date of weekDates) {
    await supabase.from('weekly_allocations').delete().eq('date', date)
    await supabase.from('waitlist').delete().eq('date', date)
  }

  if (allocations.length > 0) {
    const rows: WeeklyAllocationInsert[] = allocations.map((a) => ({
      user_id: a.user_id,
      spot_id: a.spot_id,
      date: a.date,
      pass_number: a.pass_number,
    }))
    const { error } = await supabase
      .from('weekly_allocations')
      .insert(rows)
    if (error) throw new Error(`Failed to insert allocations: ${error.message}`)
  }

  if (waitlisted.length > 0) {
    const rows: WaitlistInsert[] = waitlisted.map((w) => ({
      user_id: w.user_id,
      date: w.date,
    }))
    const { error } = await supabase
      .from('waitlist')
      .insert(rows)
    if (error) throw new Error(`Failed to insert waitlist: ${error.message}`)
  }
}
