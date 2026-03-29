'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { TEAM_LABELS, VEHICLE_LABELS } from '@/lib/constants'
import type { Team, VehicleType } from '@/types/db'
import { User, Users, Car, Zap, Bike } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const vehicleIcons: Record<string, typeof Car> = {
  car: Car,
  electric: Zap,
  motorcycle: Bike,
}

export function ProfileForm({ userId, initialName }: { userId: string; initialName?: string }) {
  const [fullName, setFullName] = useState(initialName ?? '')
  const [team, setTeam] = useState<Team | ''>('')
  const [vehicleType, setVehicleType] = useState<VehicleType | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!team || !vehicleType) {
      setError('Please select your team and vehicle type.')
      return
    }
    setError(null)
    setLoading(true)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        team,
        vehicle_type: vehicleType,
      } as any)
      .eq('id', userId)

    if (updateError) {
      setError(updateError.message)
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
        id="fullName"
        label="Full Name"
        type="text"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Full name"
        icon={<User className="w-4 h-4" />}
        required
      />

      {/* Team Selection */}
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

      {/* Vehicle Type Selection */}
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
        Complete Setup
      </Button>
    </motion.form>
  )
}
