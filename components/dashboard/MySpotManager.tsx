'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Lock, Check, X, ChevronLeft, ChevronRight, Unlock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format, addDays, startOfWeek, addWeeks, isBefore, startOfDay, isToday as checkIsToday } from 'date-fns'
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
  isToday: boolean
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
        isToday: checkIsToday(d),
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

  useEffect(() => {
    const channel = supabase
      .channel('my-spot-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_allocations' }, () => {
        loadWeek(weekOffset)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, loadWeek, weekOffset])

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
          ? `Spot #${spot.label} released for ${dayLabel}`
          : `Spot #${spot.label} reclaimed for ${dayLabel}`,
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
  const releasedCount = weekDays.filter(d => !d.coming && !d.isPast).length

  return (
    <div className="space-y-4">
      {/* Spot hero card */}
      <Card padding="none">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-t-3xl px-6 py-5 text-center">
          <p className="text-blue-200 text-sm font-medium">Your Fixed Spot</p>
          <p className="text-white text-5xl font-bold mt-1">#{spot.label}</p>
        </div>
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{userName}</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Lock className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-sm text-blue-600 font-medium">Fixed assignment</span>
            </div>
          </div>
          {!loading && (
            <div className="text-right">
              <p className="text-2xl font-bold text-green-600">{comingCount}</p>
              <p className="text-[11px] text-slate-400">days this week</p>
            </div>
          )}
        </div>
      </Card>

      {/* Week schedule */}
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
            {releasedCount > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                {releasedCount} released
              </span>
            )}
          </div>
        )}

        <p className="text-xs text-slate-400 mb-3 text-center">Tap a day to release or reclaim your spot</p>

        {/* Days list */}
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
                  <div key={i} className="h-[68px] rounded-2xl bg-slate-100 animate-pulse" />
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
                            : 'border-amber-200 bg-amber-50'
                    } ${day.isToday && !day.isPast ? 'ring-2 ring-blue-600/30' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${
                        day.coming ? 'bg-green-500' : day.isPast ? 'bg-slate-200' : 'bg-amber-400'
                      }`}>
                        {day.coming ? (
                          <Check className="w-5 h-5 text-white" />
                        ) : (
                          <Unlock className="w-5 h-5 text-white" />
                        )}
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{day.dayName}</p>
                          {day.isToday && !day.isPast && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">Today</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{format(new Date(day.date + 'T12:00:00'), 'MMM d')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors duration-200 ${
                        day.isPast
                          ? (day.coming ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400')
                          : day.coming
                            ? 'bg-green-500 text-white'
                            : 'bg-amber-400 text-white'
                      }`}>
                        {day.coming ? 'Coming' : day.isPast ? 'Released' : 'Released'}
                      </span>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </Card>

      {/* Explanation card */}
      <Card padding="md">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Unlock className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">How releasing works</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              When you release your spot for a day, it becomes available for others.
              If someone is on the waitlist, they'll automatically get your spot.
              You can reclaim it anytime as long as no one else has taken it.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
