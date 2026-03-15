'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="space-y-5"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <Input
        id="email"
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@shield.ai"
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
            placeholder="Your password"
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
        Sign In
      </Button>

      <p className="text-center text-sm text-slate-500">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-blue-600 font-semibold hover:underline">
          Sign up
        </Link>
      </p>
    </motion.form>
  )
}
