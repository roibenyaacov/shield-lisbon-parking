'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DAY_KEYS, DAY_LABELS, DAY_NAMES, LISBON_TIMEZONE, REQUEST_OPEN_DAY, REQUEST_OPEN_HOUR, TEAM_DAY_MAP, TEAM_LABELS } from '@/lib/constants'
import { toZonedTime } from 'date-fns-tz'
import { addDays, nextMonday, format, differenceInSeconds } from 'date-fns'
import { Check, Clock, CalendarDays, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Team, WeeklyRequest } from '@/types/db'

interface RequestFormProps {
  userId: string
  userTeam: Team
  existingRequest?: WeeklyRequest | null
}

function getNextWeekStart(): Date {
  return nextMonday(new Date())
}

function getOpenTime(): Date {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const d = new Date(now)
  const diff = (REQUEST_OPEN_DAY - dayOfWeek + 7) % 7
  d.setDate(d.getDate() + (diff === 0 && now.getHours() >= REQUEST_OPEN_HOUR ? 7 : diff))
  d.setHours(REQUEST_OPEN_HOUR, 0, 0, 0)
  return d
}

function isFormOpen(): boolean {
  const now = toZonedTime(new Date(), LISBON_TIMEZONE)
  const day = now.getDay()
  const hour = now.getHours()
  if (day === REQUEST_OPEN_DAY && hour >= REQUEST_OPEN_HOUR) return true
  if (day === 4 || day === 5) return true
  return false
}

function CountdownTimer({ targetDate }: { targetDate: Date }) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const diff = differenceInSeconds(targetDate, now)
      if (diff <= 0) {
        setTimeLeft('Opening now...')
        return
      }
      const d = Math.floor(diff / 86400)
      const h = Math.floor((diff % 86400) / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      setTimeLeft(
        `${d > 0 ? `${d}d ` : ''}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      )
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [targetDate])

  return (
    <motion.div
      className="text-center space-y-4 py-2"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <motion.div
        className="w-20 h-20 mx-auto bg-amber-100 rounded-3xl flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
      >
        <Clock className="w-10 h-10 text-amber-600" />
      </motion.div>
      <h3 className="text-xl font-bold text-slate-900">Registration Not Open Yet</h3>
      <p className="text-slate-500 text-sm leading-relaxed">
        Parking registration opens every<br />Wednesday at 19:00 (Lisbon time)
      </p>
      <div className="bg-slate-50 rounded-2xl px-5 py-4">
        <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Opens in</p>
        <p className="text-3xl font-bold text-slate-900 font-mono tracking-wider">{timeLeft}</p>
      </div>
    </motion.div>
  )
}

export function RequestForm({ userId, userTeam, existingRequest }: RequestFormProps) {
  const [days, setDays] = useState({
    mon: existingRequest?.mon ?? false,
    tue: existingRequest?.tue ?? false,
    wed: existingRequest?.wed ?? false,
    thu: existingRequest?.thu ?? false,
    fri: existingRequest?.fri ?? false,
  })
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(!!existingRequest)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(isFormOpen())

  const supabase = createClient()
  const weekStart = getNextWeekStart()

  useEffect(() => {
    const interval = setInterval(() => {
      setOpen(isFormOpen())
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  const teamDayIndex = DAY_NAMES.findIndex((day) =>
    TEAM_DAY_MAP[day]?.includes(userTeam)
  )

  const toggleDay = (key: keyof typeof days) => {
    if (navigator.vibrate) navigator.vibrate(10)
    setDays((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const selectedCount = Object.values(days).filter(Boolean).length
    if (selectedCount === 0) {
      setError('Please select at least one day.')
      return
    }
    if (selectedCount > 3) {
      setError('Maximum 3 days per week.')
      return
    }

    setError(null)
    setLoading(true)

    const weekStartStr = format(weekStart, 'yyyy-MM-dd')

    const { error: upsertError } = await supabase
      .from('weekly_requests')
      .upsert(
        {
          user_id: userId,
          week_start: weekStartStr,
          ...days,
        } as any,
        { onConflict: 'user_id,week_start' }
      )

    if (upsertError) {
      setError(upsertError.message)
      setLoading(false)
      return
    }

    setSubmitted(true)
    setLoading(false)
  }

  if (!open) {
    return (
      <Card padding="lg">
        <CountdownTimer targetDate={getOpenTime()} />
      </Card>
    )
  }

  if (submitted) {
    return (
      <Card padding="lg">
        <motion.div
          className="text-center space-y-4 py-2"
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
          <h3 className="text-xl font-bold text-slate-900">Request Submitted</h3>
          <p className="text-slate-500 text-sm leading-relaxed">
            Your parking request for the week of<br />
            <strong className="text-slate-700">{format(weekStart, 'MMMM d, yyyy')}</strong> has been saved.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <p className="text-xs text-blue-600 font-medium mb-2">Requested days:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {DAY_KEYS.map((key, i) =>
                days[key] ? (
                  <motion.span
                    key={key}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 + i * 0.05 }}
                    className="bg-blue-600 text-white text-xs font-semibold px-3.5 py-1.5 rounded-full"
                  >
                    {DAY_LABELS[DAY_NAMES[i]]}
                  </motion.span>
                ) : null
              )}
            </div>
          </div>
          <p className="text-xs text-slate-400">Allocations will be announced Friday morning.</p>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setSubmitted(false)}
          >
            Edit Request
          </Button>
        </motion.div>
      </Card>
    )
  }

  const selectedCount = Object.values(days).filter(Boolean).length

  return (
    <Card padding="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">
              Week of {format(weekStart, 'MMM d, yyyy')}
            </h3>
            <p className="text-xs text-slate-500">Select the days you need parking (max 3)</p>
          </div>
        </div>

        <div className="space-y-2">
          {DAY_KEYS.map((key, i) => {
            const isTeamDay = i === teamDayIndex
            const dayName = DAY_NAMES[i]
            const teamsForDay = TEAM_DAY_MAP[dayName] ?? []
            const isSelected = days[key]

            return (
              <motion.button
                key={key}
                type="button"
                onClick={() => toggleDay(key)}
                whileTap={{ scale: 0.98 }}
                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 transition-all duration-200 touch-manipulation ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50 shadow-lg shadow-blue-600/10'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
                }`}
              >
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {DAY_LABELS[dayName]}
                    </span>
                    {isTeamDay && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-600 text-white px-2 py-0.5 rounded-full">
                        Your Team Day
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Priority: {teamsForDay.map((t) => TEAM_LABELS[t as Team]).join(', ')}
                  </p>
                </div>
                <div
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                    isSelected
                      ? 'border-blue-600 bg-blue-600 scale-110'
                      : 'border-slate-300'
                  }`}
                >
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                      >
                        <Check className="w-4 h-4 text-white" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.button>
            )
          })}
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
          Submit Request ({selectedCount}/3 days)
        </Button>
      </form>
    </Card>
  )
}
