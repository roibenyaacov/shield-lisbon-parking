'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Lock, CalendarDays, Check, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format, addDays, startOfWeek, addWeeks, isBefore, startOfDay } from 'date-fns'
import { DAY_LABELS, DAY_NAMES } from '@/lib/constants'
import type { ParkingSpot } from '@/types/db'
import toast from 'react-hot-toast'

interface MySpotManagerProps {
  userId: string
  userName: string
  spot: ParkingSpot
}

interface DayStatus {
  date: string
  dayName: string
  coming: boolean
  toggling: boolean
  isPast: boolean
}

export function MySpotManager({ userId, userName, spot }: MySpotManagerProps) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [weekDays, setWeekDays] = useState<DayStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [direction, setDirection] = useState(0)
  const supabase = createClient()

  const loadWeek = useCallback(async (offset: number) => {
    setLoading(true)
    const monday = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), offset)
    const today = startOfDay(new Date())
    const dates = Array.from({ length: 5 }, (_, i) => {
      const d = addDays(monday, i)
      return {
        date: format(d, 'yyyy-MM-dd'),
        dayName: DAY_LABELS[DAY_NAMES[i]],
        isPast: isBefore(d, today),
      }
    })

    const { data: allocations } = await supabase
      .from('weekly_allocations')
      .select('date')
      .eq('user_id', userId)
      .eq('spot_id', spot.id)
      .in('date', dates.map(d => d.date))

    const allocatedDates = new Set((allocations ?? []).map((a: any) => a.date))

    setWeekDays(dates.map(d => ({
      ...d,
      coming: allocatedDates.has(d.date),
      toggling: false,
    })))
    setLoading(false)
  }, [userId, spot.id, supabase])

  useEffect(() => {
    loadWeek(weekOffset)
  }, [weekOffset])

  const goToWeek = (dir: number) => {
    if (navigator.vibrate) navigator.vibrate(10)
    setDirection(dir)
    setWeekOffset(prev => prev + dir)
  }

  const toggleDay = async (date: string, currentlyComing: boolean) => {
    if (navigator.vibrate) navigator.vibrate(10)

    setWeekDays(prev => prev.map(d =>
      d.date === date ? { ...d, toggling: true } : d
    ))

    const res = await fetch('/api/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        spot_id: spot.id,
        user_id: userId,
        action: currentlyComing ? 'release' : 'reclaim',
      }),
    })

    if (res.ok) {
      setWeekDays(prev => prev.map(d =>
        d.date === date ? { ...d, coming: !currentlyComing, toggling: false } : d
      ))
      const dayLabel = format(new Date(date + 'T12:00:00'), 'EEEE, MMM d')
      toast.success(
        currentlyComing
          ? `Released for ${dayLabel}`
          : `Reclaimed for ${dayLabel}`,
        { icon: currentlyComing ? '🔓' : '🅿️' }
      )
    } else {
      setWeekDays(prev => prev.map(d =>
        d.date === date ? { ...d, toggling: false } : d
      ))
      toast.error('Something went wrong. Try again.')
    }
  }

  const monday = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset)
  const friday = addDays(monday, 4)
  const weekLabel = weekOffset === 0
    ? 'This Week'
    : weekOffset === 1
      ? 'Next Week'
      : `${format(monday, 'MMM d')} – ${format(friday, 'MMM d')}`

  const comingCount = weekDays.filter(d => d.coming).length
  const notComingCount = weekDays.filter(d => !d.coming && !d.isPast).length

  return (
    <div className="space-y-4">
      <Card padding="lg">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
            <span className="text-white text-2xl font-bold">#{spot.label}</span>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-900">{userName}&apos;s Spot</h2>
            <div className="flex items-center gap-1.5 mt-1">
              <Lock className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-sm text-blue-600 font-medium">Fixed assignment</span>
            </div>
          </div>
        </div>
      </Card>

      <Card padding="lg">
        {/* Week navigation */}
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={() => goToWeek(-1)}
            disabled={weekOffset <= 0}
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all touch-manipulation disabled:opacity-30"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>

          <div className="text-center">
            <h3 className="font-bold text-slate-900">{weekLabel}</h3>
            <p className="text-xs text-slate-400">
              {format(monday, 'MMM d')} – {format(friday, 'MMM d, yyyy')}
            </p>
          </div>

          <button
            onClick={() => goToWeek(1)}
            disabled={weekOffset >= 4}
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all touch-manipulation disabled:opacity-30"
          >
            <ChevronRight className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Summary pills */}
        {!loading && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
              {comingCount} coming
            </span>
            {notComingCount > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                {notComingCount} off
              </span>
            )}
          </div>
        )}

        <p className="text-xs text-slate-400 mb-3">Tap a day to toggle your attendance</p>

        {/* Days list with animation on week change */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={weekOffset}
            initial={{ opacity: 0, x: direction * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -60 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
          >
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {weekDays.map((day, i) => (
                  <motion.button
                    key={day.date}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 25 }}
                    whileTap={day.isPast ? {} : { scale: 0.97 }}
                    disabled={day.toggling || day.isPast}
                    onClick={() => !day.isPast && toggleDay(day.date, day.coming)}
                    className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 transition-all duration-200 touch-manipulation ${
                      day.isPast
                        ? 'opacity-40 border-slate-100 bg-slate-50 cursor-default'
                        : day.toggling
                          ? 'opacity-60 border-slate-200'
                          : day.coming
                            ? 'border-green-300 bg-green-50'
                            : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${
                        day.coming ? 'bg-green-500' : 'bg-slate-200'
                      }`}>
                        {day.coming ? (
                          <Check className="w-5 h-5 text-white" />
                        ) : (
                          <X className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-slate-900">{day.dayName}</p>
                        <p className="text-xs text-slate-400">{format(new Date(day.date + 'T12:00:00'), 'MMM d')}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors duration-200 ${
                      day.isPast
                        ? (day.coming ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400')
                        : day.coming
                          ? 'bg-green-500 text-white'
                          : 'bg-slate-200 text-slate-500'
                    }`}>
                      {day.coming ? 'Coming' : 'Not coming'}
                    </span>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </Card>
    </div>
  )
}
