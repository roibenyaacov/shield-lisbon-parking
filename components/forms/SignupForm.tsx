'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { TEAM_LABELS, VEHICLE_LABELS } from '@/lib/constants'
import type { Team, VehicleType } from '@/types/db'
import { User, Mail, Lock, Eye, EyeOff, Users, Car, Zap, Bike, ShieldCheck, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'

const vehicleIcons: Record<string, typeof Car> = {
  car: Car,
  electric: Zap,
  motorcycle: Bike,
}

function OTPInput({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(6, '').split('').slice(0, 6)

  const focusInput = (index: number) => {
    inputRefs.current[index]?.focus()
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const newDigits = [...digits]
      if (newDigits[index] && newDigits[index] !== '') {
        newDigits[index] = ''
      } else if (index > 0) {
        newDigits[index - 1] = ''
        focusInput(index - 1)
      }
      onChange(newDigits.join(''))
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusInput(index - 1)
    } else if (e.key === 'ArrowRight' && index < 5) {
      focusInput(index + 1)
    }
  }

  const handleInput = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const char = e.target.value.replace(/\D/g, '').slice(-1)
    if (!char) return

    if (navigator.vibrate) navigator.vibrate(10)
    const newDigits = [...digits]
    newDigits[index] = char
    onChange(newDigits.join(''))

    if (index < 5) {
      focusInput(index + 1)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length > 0) {
      onChange(pasted.padEnd(6, '').slice(0, 6))
      focusInput(Math.min(pasted.length, 5))
    }
  }

  useEffect(() => {
    focusInput(0)
  }, [])

  return (
    <div className="flex justify-center gap-2.5" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <motion.input
          key={i}
          ref={(el) => { inputRefs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit === ' ' ? '' : digit}
          onChange={(e) => handleInput(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 25 }}
          className={`w-12 h-14 text-center text-xl font-bold rounded-2xl border-2 transition-all duration-200 focus:outline-none touch-manipulation ${
            digit && digit !== ' '
              ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-lg shadow-blue-600/10'
              : 'border-slate-200 bg-white text-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20'
          }`}
        />
      ))}
    </div>
  )
}

export function SignupForm() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [team, setTeam] = useState<Team | ''>('')
  const [vehicleType, setVehicleType] = useState<VehicleType | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [otpCode, setOtpCode] = useState('')
  const [resendCountdown, setResendCountdown] = useState(0)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCountdown])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!team || !vehicleType) {
      setError('Please select your team and vehicle type.')
      return
    }

    setError(null)
    setLoading(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          team,
          vehicle_type: vehicleType,
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // Profile is created by the handle_new_user database trigger using the
    // metadata passed above.  No client-side update is needed here — the
    // user has no confirmed session yet so any direct table write would be
    // blocked by RLS anyway.

    setStep('otp')
    setResendCountdown(60)
    setLoading(false)
  }

  const handleVerifyOTP = async () => {
    const code = otpCode.replace(/\s/g, '')
    if (code.length !== 6) {
      setError('Please enter the full 6-digit code.')
      return
    }

    setError(null)
    setLoading(true)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    })

    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  const handleResendOTP = async () => {
    if (resendCountdown > 0) return
    setError(null)
    setLoading(true)

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
    })

    if (resendError) {
      setError(resendError.message)
    } else {
      setResendCountdown(60)
    }
    setLoading(false)
  }

  return (
    <AnimatePresence mode="wait">
      {step === 'otp' ? (
        <motion.div
          key="otp"
          className="space-y-6 py-2"
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className="text-center space-y-3">
            <motion.div
              className="w-20 h-20 mx-auto bg-blue-100 rounded-3xl flex items-center justify-center"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
            >
              <ShieldCheck className="w-10 h-10 text-blue-600" />
            </motion.div>
            <h3 className="text-xl font-bold text-slate-900">Verify your email</h3>
            <p className="text-slate-500 text-sm leading-relaxed">
              We sent a 6-digit code to<br />
              <strong className="text-slate-700">{email}</strong>
            </p>
          </div>

          <OTPInput value={otpCode} onChange={setOtpCode} />

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="rounded-xl bg-red-50 border border-red-100 px-4 py-3"
              >
                <p className="text-sm text-red-600 text-center">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <Button
            type="button"
            onClick={handleVerifyOTP}
            isLoading={loading}
            fullWidth
            size="lg"
            disabled={otpCode.replace(/\s/g, '').length !== 6}
          >
            Verify & Continue
          </Button>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => { setStep('form'); setError(null); setOtpCode('') }}
              className="text-sm text-slate-500 flex items-center gap-1 active:scale-95 transition-all touch-manipulation"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            <button
              type="button"
              onClick={handleResendOTP}
              disabled={resendCountdown > 0 || loading}
              className={`text-sm font-medium transition-all touch-manipulation active:scale-95 ${
                resendCountdown > 0 ? 'text-slate-400' : 'text-blue-600 hover:underline'
              }`}
            >
              {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code'}
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.form
          key="form"
          onSubmit={handleSubmit}
          className="space-y-5"
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <Input
            id="fullName"
            label="Full Name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            icon={<User className="w-4 h-4" />}
            required
          />
          <Input
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name.surname@shieldfc.com"
            icon={<Mail className="w-4 h-4" />}
            required
          />

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-semibold text-slate-700">
              Password
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

          <div className="flex items-center gap-3 pt-1">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Your Details</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                Team
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TEAM_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    if (navigator.vibrate) navigator.vibrate(10)
                    setTeam(value as Team)
                  }}
                  className={`px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all duration-200 active:scale-[0.98] touch-manipulation ${
                    team === value
                      ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-lg shadow-blue-600/20'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">Vehicle Type</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(VEHICLE_LABELS).map(([value, label]) => {
                const Icon = vehicleIcons[value] ?? Car
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      if (navigator.vibrate) navigator.vibrate(10)
                      setVehicleType(value as VehicleType)
                    }}
                    className={`flex flex-col items-center gap-2 px-3 py-4 rounded-2xl border-2 text-sm font-medium transition-all duration-200 active:scale-[0.98] touch-manipulation ${
                      vehicleType === value
                        ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-lg shadow-blue-600/20'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:shadow-md'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      vehicleType === value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-xs">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="rounded-xl bg-red-50 border border-red-100 px-4 py-3"
              >
                <p className="text-sm text-red-600">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <Button type="submit" isLoading={loading} fullWidth size="lg">
            Create Account
          </Button>

          <p className="text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-600 font-semibold hover:underline">
              Sign in
            </Link>
          </p>
        </motion.form>
      )}
    </AnimatePresence>
  )
}
