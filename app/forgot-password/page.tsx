'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (resetError) {
      setError(resetError.message)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-orange-50/20 flex items-center justify-center px-4 ios-safe-top ios-safe-bottom">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Shield Parking" className="h-11 sm:h-10 w-auto mx-auto mb-5" />
          <h1 className="text-3xl font-bold text-slate-900">Reset password</h1>
          <p className="text-slate-500 text-sm mt-1.5">We&apos;ll send you a reset link</p>
        </div>

        <div className="rounded-3xl border border-slate-200/50 bg-white/80 backdrop-blur-sm p-6" style={{ boxShadow: 'var(--ios-shadow-lg)' }}>
          {sent ? (
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
              <h3 className="text-xl font-bold text-slate-900">Check your email</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                We sent a password reset link to<br />
                <strong className="text-slate-700">{email}</strong>
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                <p className="text-xs text-blue-700">
                  Click the link in your email to choose a new password. The link expires in 60 minutes.
                </p>
              </div>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 font-semibold hover:underline active:scale-95 transition-all touch-manipulation"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Sign In
              </Link>
            </motion.div>
          ) : (
            <motion.form
              onSubmit={handleSubmit}
              className="space-y-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            >
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email Address"
                icon={<Mail className="w-4 h-4" />}
                required
              />

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl bg-red-50 border border-red-100 px-4 py-3"
                >
                  <p className="text-sm text-red-600">{error}</p>
                </motion.div>
              )}

              <Button type="submit" isLoading={loading} fullWidth size="lg">
                Send Reset Link
              </Button>

              <p className="text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 active:scale-95 transition-all touch-manipulation"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Sign In
                </Link>
              </p>
            </motion.form>
          )}
        </div>
      </div>
    </div>
  )
}
