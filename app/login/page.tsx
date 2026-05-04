import { LoginForm } from '@/components/forms/LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>
}) {
  const params = await searchParams
  const error = params.error === 'auth_callback_error'
    ? 'Email verification failed. Please try again or sign up again.'
    : null
  const message = params.message

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-orange-50/20 flex items-center justify-center px-4 ios-safe-top ios-safe-bottom" suppressHydrationWarning>
      <div className="w-full max-w-sm" suppressHydrationWarning>
        <div className="text-center mb-8" suppressHydrationWarning>
          <img src="/logo.png" alt="Shield Parking" className="h-11 sm:h-10 w-auto mx-auto mb-5" />
          <h1 className="text-3xl font-bold text-slate-900" suppressHydrationWarning>Welcome back</h1>
          <p className="text-slate-500 text-sm mt-1.5" suppressHydrationWarning>Sign in to manage your parking</p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-4 rounded-2xl bg-green-50 border border-green-100 px-4 py-3 text-sm text-green-700">
            {message}
          </div>
        )}

        <div className="rounded-3xl border border-slate-200/50 bg-white/80 backdrop-blur-sm p-6" style={{ boxShadow: 'var(--ios-shadow-lg)' }}>
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
