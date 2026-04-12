export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Shell } from '@/components/layout/Shell'
import { MyWeek } from '@/components/dashboard/MyWeek'
import { RequestForm } from '@/components/forms/RequestForm'
import { nextMonday, format } from 'date-fns'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import type { Profile, ParkingSpot, WeeklyRequest } from '@/types/db'

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

  const hasFixedSpot = await supabase
    .from('parking_spots')
    .select('id')
    .eq('fixed_user_id', user.id)
    .single()
    .then(r => !!r.data)

  if (hasFixedSpot) {
    redirect('/my-spot')
  }

  const weekStart = format(nextMonday(new Date()), 'yyyy-MM-dd')

  const { data: rawRequest } = await supabase
    .from('weekly_requests')
    .select('*')
    .eq('user_id', user.id)
    .eq('week_start', weekStart)
    .single()

  const existingRequest = rawRequest as WeeklyRequest | null

  return (
    <Shell showAdminLink={profile.role === 'admin'}>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Hey, {profile.full_name?.split(' ')[0]} 👋
            </h1>
          </div>
          <SignOutButton />
        </div>

        <MyWeek userId={user.id} userName={profile.full_name ?? undefined} />

        <RequestForm
          userId={user.id}
          userTeam={profile.team}
          existingRequest={existingRequest}
        />
      </div>
    </Shell>
  )
}
