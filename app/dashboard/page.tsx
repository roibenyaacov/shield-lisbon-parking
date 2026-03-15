export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Shell } from '@/components/layout/Shell'
import { WeeklyGrid } from '@/components/dashboard/WeeklyGrid'
import { Card } from '@/components/ui/Card'
import { startOfWeek, format, addDays } from 'date-fns'
import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import type { Profile, ParkingSpot, WeeklyAllocation } from '@/types/db'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rawProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const profile = rawProfile as Profile | null

  if (!profile?.team || !profile?.vehicle_type) {
    redirect('/profile-setup')
  }

  const now = new Date()
  const monday = startOfWeek(now, { weekStartsOn: 1 })
  const weekStart = format(monday, 'yyyy-MM-dd')

  const weekDates = Array.from({ length: 5 }, (_, i) =>
    format(addDays(monday, i), 'yyyy-MM-dd')
  )

  const [spotsRes, allocsRes] = await Promise.all([
    supabase.from('parking_spots').select('*').eq('is_active', true).order('label'),
    supabase
      .from('weekly_allocations')
      .select('*, user:profiles(*)')
      .in('date', weekDates),
  ])

  const spots = (spotsRes.data ?? []) as ParkingSpot[]
  const allocations = (allocsRes.data ?? []) as (WeeklyAllocation & { user: Profile })[]

  return (
    <Shell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome, {profile.full_name?.split(' ')[0]}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">Lisbon Office Parking</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/request"
              className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 rounded-2xl shadow-lg shadow-blue-600/30 hover:bg-blue-700 hover:shadow-xl active:scale-[0.98] transition-all duration-200 touch-manipulation haptic-feedback"
            >
              <CalendarDays className="w-4 h-4" />
              Request
            </Link>
            <SignOutButton />
          </div>
        </div>

        {/* Grid Card */}
        <Card padding="lg">
          <WeeklyGrid
            userId={user.id}
            initialSpots={spots}
            initialAllocations={allocations}
            initialWeekStart={weekStart}
          />
        </Card>
      </div>
    </Shell>
  )
}
