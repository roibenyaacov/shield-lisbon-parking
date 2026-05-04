export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileForm } from '@/components/forms/ProfileForm'

export default async function ProfileSetupPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const initialName = user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? ''

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-orange-50/20 flex items-center justify-center px-4 ios-safe-top ios-safe-bottom">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Shield Parking" className="h-11 sm:h-10 w-auto mx-auto mb-5" />
          <h1 className="text-3xl font-bold text-slate-900">Complete Your Profile</h1>
          <p className="text-slate-500 text-sm mt-1.5">
            Tell us about yourself so we can assign parking
          </p>
        </div>
        <div className="rounded-3xl border border-slate-200/50 bg-white/80 backdrop-blur-sm p-6" style={{ boxShadow: 'var(--ios-shadow-lg)' }}>
          <ProfileForm userId={user.id} initialName={initialName} />
        </div>
      </div>
    </div>
  )
}
