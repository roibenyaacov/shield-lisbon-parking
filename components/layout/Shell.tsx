'use client'

import { Navbar } from './Navbar'
import { Toaster } from 'react-hot-toast'

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-orange-50/20">
      <Toaster
        position="top-center"
        containerClassName="ios-safe-top"
        toastOptions={{
          className: 'notification-toast',
          duration: 5000,
          style: {
            borderRadius: '16px',
            padding: '12px 16px',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: 'var(--ios-shadow-xl)',
          },
        }}
      />
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 pb-8 ios-safe-bottom">
        {children}
      </main>
    </div>
  )
}
