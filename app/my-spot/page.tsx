export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Shell } from '@/components/layout/Shell'
import { MySpotManager } from '@/components/dashboard/MySpotManager'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
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
    <Shell>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center active:scale-[0.95] transition-all duration-200 touch-manipulation haptic-feedback"
          >
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Spot</h1>
            <p className="text-sm text-slate-500">Manage your fixed parking spot #{fixedSpot.label}</p>
          </div>
        </div>
        <MySpotManager
          userId={user.id}
          userName={profile.full_name ?? 'User'}
          spot={fixedSpot}
        />
      </div>
    </Shell>
  )
}
