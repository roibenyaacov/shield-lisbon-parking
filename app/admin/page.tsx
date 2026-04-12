export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Shell } from '@/components/layout/Shell'
import { AdminDashboard } from '@/components/admin/AdminDashboard'
import { SignOutButton } from '@/components/dashboard/SignOutButton'
import type { Profile } from '@/types/db'

export default async function AdminPage() {
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
  if (profile.role !== 'admin') redirect('/dashboard')

  return (
    <Shell showAdminLink>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div />
          <SignOutButton />
        </div>
        <AdminDashboard adminName={profile.full_name ?? 'Admin'} />
      </div>
    </Shell>
  )
}
