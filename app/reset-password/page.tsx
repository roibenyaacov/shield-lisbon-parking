'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import {
  cleanResetPasswordUrl,
  parseRecoveryUrl,
  wait,
} from '@/lib/auth/recovery'
import { Button } from '@/components/ui/Button'
import { Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { motion } from 'framer-motion'

const RECOVERY_WAIT_MS = 5000
const RECOVERY_POLL_MS = 250

async function getActiveSession(supabase: SupabaseClient): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

async function waitForRecoverySession(
  supabase: SupabaseClient,
  timeoutMs = RECOVERY_WAIT_MS
): Promise<Session | null> {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const session = await getActiveSession(supabase)
    if (session) return session
    await wait(RECOVERY_POLL_MS)
  }

  return null
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [ready, setReady] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(true)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const bootstrapStartedRef = useRef(false)

  useEffect(() => {
    if (bootstrapStartedRef.current) return
    bootstrapStartedRef.current = true

    let cancelled = false

    const markReady = () => {
      if (cancelled) return
      setReady(true)
      setError(null)
      cleanResetPasswordUrl()
      setBootstrapping(false)
    }

    const fail = (message: string, details?: Record<string, unknown>) => {
      if (cancelled) return
      if (details) {
        console.error('Password recovery bootstrap failed', details)
      }
      setError(message)
      setBootstrapping(false)
    }

    const bootstrapRecoverySession = async () => {
      const params = parseRecoveryUrl(window.location.href)

      if (params.authError) {
        fail('Your reset link has expired or is invalid. Please request a new one.', {
          auth_error: params.authError,
        })
        return
      }

      try {
        // Wait for the browser client to finish URL detection before handling
        // formats that @supabase/ssr does not consume itself.
        const { error: initializeError } = await supabase.auth.initialize()

        if (params.tokenHash && params.type === 'recovery') {
          const { data, error: verifyError } = await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash: params.tokenHash,
          })
          if (verifyError || !data.session) throw verifyError ?? new Error('Recovery session missing')

          markReady()
          return
        }

        if (params.accessToken && params.refreshToken) {
          // createBrowserClient uses PKCE and rejects implicit callback URLs.
          // Always install the recovery tokens explicitly so a pre-existing
          // session can never be mistaken for the recovery session.
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: params.accessToken,
            refresh_token: params.refreshToken,
          })
          if (sessionError || !data.session) throw sessionError ?? new Error('Recovery session missing')

          markReady()
          return
        }

        if (params.code) {
          // Successful PKCE auto-detection removes `code`. Only exchange it
          // manually when the browser client did not consume it.
          if (new URL(window.location.href).searchParams.has('code')) {
            const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code)
            if (exchangeError || !data.session) {
              throw exchangeError ?? new Error('Recovery session missing')
            }
          } else {
            if (initializeError) throw initializeError
            const session = await getActiveSession(supabase)
            if (!session) throw new Error('Recovery session missing')
          }

          markReady()
          return
        }

        if (initializeError) throw initializeError

        const session = await waitForRecoverySession(supabase, 1500)
        if (session) {
          markReady()
          return
        }

        fail('Your reset link has expired or is invalid. Please request a new one.', {
          has_code: Boolean(params.code),
          has_token_hash: Boolean(params.tokenHash),
          has_access_token: Boolean(params.accessToken),
          recovery_type: params.type,
        })
      } catch (sessionError) {
        fail('Your reset link has expired or is invalid. Please request a new one.', {
          has_code: Boolean(params.code),
          has_token_hash: Boolean(params.tokenHash),
          has_access_token: Boolean(params.accessToken),
          recovery_type: params.type,
          message: sessionError instanceof Error ? sessionError.message : String(sessionError),
        })
      }
    }

    void bootstrapRecoverySession()

    return () => {
      cancelled = true
    }
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (bootstrapping) {
      setError('Still verifying your reset link. Please wait a moment and try again.')
      return
    }

    if (!ready) {
      setError('Your reset link has expired or is invalid. Please request a new one.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setError(null)
    setLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      console.error('Password update failed', { message: updateError.message })
      setError(updateError.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)

    setTimeout(() => {
      router.push('/dashboard')
      router.refresh()
    }, 2000)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-orange-50/20 flex items-center justify-center px-4 ios-safe-top ios-safe-bottom">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Shield Parking" className="h-11 sm:h-10 w-auto mx-auto mb-5" />
          <h1 className="text-3xl font-bold text-slate-900">New password</h1>
          <p className="text-slate-500 text-sm mt-1.5">Choose a new password for your account</p>
        </div>

        <div className="rounded-3xl border border-slate-200/50 bg-white/80 backdrop-blur-sm p-6" style={{ boxShadow: 'var(--ios-shadow-lg)' }}>
          {bootstrapping ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500">Verifying your reset link...</p>
            </div>
          ) : success ? (
            <motion.div
              className="text-center space-y-5 py-2"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <motion.div
                className="w-20 h-20 mx-auto bg-green-100 rounded-3xl flex items-center justify-center"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
              >
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </motion.div>
              <h3 className="text-xl font-bold text-slate-900">Password updated!</h3>
              <p className="text-slate-500 text-sm">Redirecting to dashboard...</p>
            </motion.div>
          ) : (
            <motion.form
              onSubmit={handleSubmit}
              className="space-y-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    minLength={6}
                    required
                    className="w-full h-12 rounded-xl border border-slate-200 bg-white text-sm pl-11 pr-12 transition-all duration-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 focus:outline-none touch-manipulation"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 p-1 rounded-lg active:scale-95 touch-manipulation"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-700">
                  Confirm Password
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    minLength={6}
                    required
                    className="w-full h-12 rounded-xl border border-slate-200 bg-white text-sm pl-11 pr-4 transition-all duration-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 focus:outline-none touch-manipulation"
                  />
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-red-500">Passwords do not match</p>
                )}
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl bg-red-50 border border-red-100 px-4 py-3"
                >
                  <p className="text-sm text-red-600">{error}</p>
                  <Link href="/forgot-password" className="mt-2 inline-block text-xs font-semibold text-red-700 underline">
                    Request a new reset link
                  </Link>
                </motion.div>
              )}

              <Button type="submit" isLoading={loading} fullWidth size="lg" disabled={!ready}>
                Update Password
              </Button>
            </motion.form>
          )}
        </div>
      </div>
    </div>
  )
}
