'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LogOut } from 'lucide-react'

export function SignOutButton() {
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    if (navigator.vibrate) navigator.vibrate(10)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="inline-flex items-center gap-1.5 text-slate-500 text-sm font-medium px-3 py-2.5 rounded-xl hover:bg-slate-100 active:scale-[0.98] transition-all duration-200 touch-manipulation haptic-feedback"
      title="Sign out"
    >
      <LogOut className="w-4 h-4" />
    </button>
  )
}
