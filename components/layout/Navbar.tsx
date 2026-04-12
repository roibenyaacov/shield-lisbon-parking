'use client'

import Link from 'next/link'
import { LayoutDashboard } from 'lucide-react'

interface NavbarProps {
  showAdminLink?: boolean
}

export function Navbar({ showAdminLink }: NavbarProps) {
  return (
    <header className="sticky top-0 z-40 ios-safe-top">
      <div
        className="bg-white/80 border-b border-slate-200/50 shadow-sm"
        style={{ backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
      >
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="w-9" />
          <Link href="/dashboard">
            <img src="/logo.png" alt="Shield Parking" className="h-8 w-auto object-contain" />
          </Link>
          <div className="w-9 flex justify-end">
            {showAdminLink && (
              <Link
                href="/admin"
                className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 active:scale-95 transition-all"
                title="Admin Dashboard"
              >
                <LayoutDashboard className="w-4 h-4 text-slate-600" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
