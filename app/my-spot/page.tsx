export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Shell } from '@/components/layout/Shell'
import { MyWeek } from '@/components/dashboard/MyWeek'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import { FixedSpotBadge } from '@/components/dashboard/FixedSpotBadge'
import { ReleaseManager } from '@/components/dashboard/ReleaseManager'
import type { Profile, ParkingSpot } from '@/types/db'

export default async function MySpotPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rawProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const profile = rawProfile as Profile | null
  if (!profile?.team) redirect('/profile-setup')

  const { data: rawSpot } = await supabase
    .from('parking_spots')
    .select('*')
    .eq('fixed_user_id', user.id)
    .single()

  const fixedSpot = rawSpot as ParkingSpot | null

  if (!fixedSpot) {
    redirect('/dashboard')
  }

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

        <FixedSpotBadge spotLabel={fixedSpot.label} />

        <MyWeek
          userId={user.id}
          fixedSpotId={fixedSpot.id}
          fixedSpotLabel={fixedSpot.label}
          userName={profile.full_name ?? undefined}
        />

        <ReleaseManager
          userId={user.id}
          spotId={fixedSpot.id}
          spotLabel={fixedSpot.label}
        />
      </div>
    </Shell>
  )
}
