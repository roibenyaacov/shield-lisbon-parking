export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Shell } from '@/components/layout/Shell'
import { RequestForm } from '@/components/forms/RequestForm'
import { nextMonday, format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { Profile, WeeklyRequest } from '@/types/db'

export default async function RequestPage() {
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

  const weekStart = format(nextMonday(new Date()), 'yyyy-MM-dd')

  const { data: rawRequest } = await supabase
    .from('weekly_requests')
    .select('*')
    .eq('user_id', user.id)
    .eq('week_start', weekStart)
    .single()

  const existingRequest = rawRequest as WeeklyRequest | null

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
            <h1 className="text-2xl font-bold text-slate-900">Request Parking</h1>
            <p className="text-sm text-slate-500">Choose your days for next week</p>
          </div>
        </div>
        <RequestForm
          userId={user.id}
          userTeam={profile.team}
          existingRequest={existingRequest}
        />
      </div>
    </Shell>
  )
}
