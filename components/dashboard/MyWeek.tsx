'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Check, Clock, ChevronRight, ChevronLeft, ChevronDown, Zap, Bike, LogOut, PlusCircle, Lock, Car } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format, addDays, startOfWeek, addWeeks, isBefore, startOfDay, isToday } from 'date-fns'
import { DAY_LABELS, DAY_NAMES } from '@/lib/constants'
import toast from 'react-hot-toast'
import type { ParkingSpot, Profile, WeeklyAllocation } from '@/types/db'
import { ReleaseManager } from '@/components/dashboard/ReleaseManager'

interface MyWeekProps {
  userId: string
  fixedSpotId?: number
  fixedSpotLabel?: string
  userName?: string
}

interface DayInfo {
  date: string
  dayName: string
  spotLabel: string | null
  spotPriority: string | null
  spotId: number | null
  waitlisted: boolean
  isPast: boolean
  isToday: boolean
}

interface SpotInfo {
  id: number
  label: string
  priority: string
  isFixed: boolean
  fixedOwnerName: string | null
  occupantName: string | null
  isCurrentUser: boolean
  isAvailable: boolean
  isFixedAndOccupiedByOwner: boolean
  isCurrentUserFixedSpot: boolean
}

export function MyWeek({ userId, fixedSpotId, fixedSpotLabel, userName }: MyWeekProps) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [days, setDays] = useState<DayInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [daySpots, setDaySpots] = useState<SpotInfo[]>([])
  const [spotsLoading, setSpotsLoading] = useState(false)
  const [direction, setDirection] = useState(0)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ spotId: number; date: string; type: 'release' | 'claim' | 'reclaim' } | null>(null)
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
        isToday: isToday(d),
      }
    })

    const [allocsRes, waitlistRes] = await Promise.all([
      supabase
        .from('weekly_allocations')
        .select('*, spot:parking_spots(*)')
        .eq('user_id', userId)
        .in('date', dates.map(d => d.date)),
      supabase
        .from('waitlist')
        .select('date')
        .eq('user_id', userId)
        .in('date', dates.map(d => d.date)),
    ])

    const allocs = (allocsRes.data ?? []) as (WeeklyAllocation & { spot: ParkingSpot })[]
    const waitlistedDates = new Set((waitlistRes.data ?? []).map((w: any) => w.date))

    setDays(dates.map(d => {
      const alloc = allocs.find(a => a.date === d.date)
      return {
        ...d,
        spotLabel: alloc?.spot?.label ?? (fixedSpotId ? (fixedSpotLabel ?? null) : null),
        spotPriority: alloc?.spot?.priority ?? null,
        spotId: alloc?.spot?.id ?? (fixedSpotId ?? null),
        waitlisted: waitlistedDates.has(d.date),
      }
    }))
    setLoading(false)
  }, [userId, supabase])

  useEffect(() => {
    loadWeek(weekOffset)
    setExpandedDay(null)
  }, [weekOffset])

  useEffect(() => {
    const channel = supabase
      .channel('my-week-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_allocations' }, () => {
        loadWeek(weekOffset)
        if (expandedDay) loadDaySpots(expandedDay)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist' }, () => loadWeek(weekOffset))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, loadWeek, weekOffset, expandedDay])

  const loadDaySpots = async (date: string) => {
    setSpotsLoading(true)
    const [spotsRes, allocsRes] = await Promise.all([
      supabase.from('parking_spots').select('*, fixed_user:profiles!parking_spots_fixed_user_id_fkey(full_name)').eq('is_active', true).order('label'),
      supabase.from('weekly_allocations').select('*, user:profiles(*)').eq('date', date),
    ])

    const spots = (spotsRes.data ?? []) as (ParkingSpot & { fixed_user: { full_name: string } | null })[]
    const allocs = (allocsRes.data ?? []) as (WeeklyAllocation & { user: Profile })[]

    setDaySpots(spots.map(s => {
      const alloc = allocs.find(a => a.spot_id === s.id)
      const isOwnerFixedSpot = fixedSpotId != null && fixedSpotId === s.id
      const isReserved = !!s.fixed_user_id || !!s.reserved_name
      const isOccupiedByFixedOwner = isReserved && (!alloc || alloc?.user_id === s.fixed_user_id)
      return {
        id: s.id,
        label: s.label,
        priority: s.priority,
        isFixed: isReserved,
        fixedOwnerName: s.fixed_user?.full_name ?? s.reserved_name ?? null,
        occupantName: alloc?.user?.full_name ?? null,
        isCurrentUser: alloc?.user_id === userId,
        isAvailable: !alloc,
        isFixedAndOccupiedByOwner: isOccupiedByFixedOwner && !isOwnerFixedSpot,
        isCurrentUserFixedSpot: isOwnerFixedSpot,
      }
    }))
    setSpotsLoading(false)
  }

  const toggleDayExpand = (date: string) => {
    if (navigator.vibrate) navigator.vibrate(10)
    if (expandedDay === date) {
      setExpandedDay(null)
    } else {
      setExpandedDay(date)
      loadDaySpots(date)
    }
  }

  const handleSpotClick = (spot: SpotInfo, date: string) => {
    const day = days.find(d => d.date === date)
    if (!day || day.isPast) return

    if (spot.isCurrentUser) {
      setConfirmAction({ spotId: spot.id, date, type: 'release' })
    } else if (spot.isCurrentUserFixedSpot && spot.isAvailable) {
      setConfirmAction({ spotId: spot.id, date, type: 'release' })
    } else if (spot.isAvailable && !spot.isFixed) {
      const userHasSpotToday = days.find(d => d.date === date)?.spotId
      if (userHasSpotToday) {
        toast.error('You already have a spot for this day')
        return
      }
      setConfirmAction({ spotId: spot.id, date, type: 'claim' })
    }
  }

  const executeAction = async () => {
    if (!confirmAction) return
    setActionLoading(confirmAction.spotId)

    try {
      if (confirmAction.type === 'release') {
        const res = await fetch('/api/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: confirmAction.date,
            spot_id: confirmAction.spotId,
            user_id: userId,
            action: 'release',
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        toast.success('Spot released')
      } else if (confirmAction.type === 'reclaim') {
        const res = await fetch('/api/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: confirmAction.date,
            spot_id: confirmAction.spotId,
            user_id: userId,
            action: 'reclaim',
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        toast.success('Spot reclaimed!')
      } else {
        const res = await fetch('/api/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: confirmAction.date,
            spot_id: confirmAction.spotId,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        toast.success('Spot claimed!')
      }

      await loadWeek(weekOffset)
      if (expandedDay) await loadDaySpots(expandedDay)
    } catch (err: any) {
      toast.error(err.message ?? 'Action failed')
    } finally {
      setActionLoading(null)
      setConfirmAction(null)
    }
  }

  const goToWeek = (dir: number) => {
    if (navigator.vibrate) navigator.vibrate(10)
    setDirection(dir)
    setWeekOffset(prev => prev + dir)
  }

  const monday = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset)
  const friday = addDays(monday, 4)
  const weekLabel = weekOffset === 0 ? 'This Week' : weekOffset === 1 ? 'Next Week' : `${format(monday, 'MMM d')} – ${format(friday, 'MMM d')}`

  const activeDay = days.find(d => d.isToday) ?? days.find(d => !d.isPast) ?? days[0]

  return (
    <div className="space-y-4">
      {/* Hero card */}
      {!loading && activeDay?.spotLabel && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          <Card padding="none">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-t-3xl px-6 py-5 text-center">
              <p className="text-slate-300 text-sm">
                Parking for {activeDay.isToday ? 'Today' : activeDay.dayName}
              </p>
              <p className="text-white text-2xl font-bold mt-1">
                {format(new Date(activeDay.date + 'T12:00:00'), 'MMM d, yyyy')}
              </p>
            </div>
            <div className="px-6 py-6 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.15 }}
                className="w-16 h-16 mx-auto mb-3 rounded-full border-4 border-blue-600 flex items-center justify-center"
              >
                <Check className="w-8 h-8 text-blue-600" />
              </motion.div>
              <p className="text-slate-500 text-sm">Your Parking Spot</p>
              <p className="text-5xl font-bold text-slate-900 mt-1">{activeDay.spotLabel}</p>
              {fixedSpotId != null && fixedSpotLabel != null && (
                <div className="mt-5 max-w-xs mx-auto">
                  <ReleaseManager
                    userId={userId}
                    spotId={fixedSpotId}
                    spotLabel={fixedSpotLabel}
                  />
                </div>
              )}
              {activeDay.spotPriority === 'ev' && (
                <div className="flex items-center justify-center gap-1 mt-2 text-green-600">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm font-medium">EV Charging</span>
                </div>
              )}
              {activeDay.spotPriority === 'motorcycle' && (
                <div className="flex items-center justify-center gap-1 mt-2 text-orange-600">
                  <Bike className="w-4 h-4" />
                  <span className="text-sm font-medium">Motorcycle</span>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Week days list */}
      <Card padding="lg">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => goToWeek(-1)}
            disabled={weekOffset <= 0}
            className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all touch-manipulation disabled:opacity-20"
          >
            <ChevronLeft className="w-5 h-5 text-slate-500" />
          </button>
          <div className="text-center">
            <h3 className="font-bold text-slate-900 text-sm">{weekLabel}</h3>
            <p className="text-[11px] text-slate-400">{format(monday, 'MMM d')} – {format(friday, 'MMM d')}</p>
          </div>
          <button
            onClick={() => goToWeek(1)}
            disabled={weekOffset >= 4}
            className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all touch-manipulation disabled:opacity-20"
          >
            <ChevronRight className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={weekOffset}
            initial={{ opacity: 0, x: direction * 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -50 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
          >
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-[52px] rounded-xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {days.map((day, i) => (
                  <div key={day.date}>
                    <motion.button
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 25 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => toggleDayExpand(day.date)}
                      className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-all duration-200 touch-manipulation ${
                        day.isPast
                          ? 'opacity-35'
                          : expandedDay === day.date
                            ? 'bg-blue-50 ring-2 ring-blue-600/20'
                            : 'hover:bg-slate-50 active:bg-slate-100'
                      } ${day.isToday ? 'ring-2 ring-blue-600/30' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${
                          day.spotLabel
                            ? 'bg-green-500 text-white'
                            : day.waitlisted
                              ? 'bg-amber-400 text-white'
                              : 'bg-slate-100 text-slate-400'
                        }`}>
                          {day.spotLabel ? (
                            <Car className="w-4.5 h-4.5" />
                          ) : day.waitlisted ? (
                            <Clock className="w-4 h-4" />
                          ) : '–'}
                        </div>
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">{day.dayName}</p>
                            {day.isToday && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">Today</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400">{format(new Date(day.date + 'T12:00:00'), 'MMM d')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {day.spotLabel ? (
                          <span className="text-xs font-semibold text-green-700">{day.spotLabel}</span>
                        ) : day.waitlisted ? (
                          <span className="text-xs font-semibold text-amber-600">Waitlist</span>
                        ) : (
                          <span className="text-xs text-slate-400">No spot</span>
                        )}
                        <motion.div
                          animate={{ rotate: expandedDay === day.date ? 180 : 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <ChevronDown className="w-4 h-4 text-slate-300" />
                        </motion.div>
                      </div>
                    </motion.button>

                    {/* Expanded day: spot grid */}
                    <AnimatePresence>
                      {expandedDay === day.date && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                          className="overflow-hidden"
                        >
                          <div className="px-2 pt-2 pb-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-slate-500">All Spots</p>
                              {!spotsLoading && (
                                <div className="flex items-center gap-3">
                                  <span className="flex items-center gap-1 text-[10px] font-medium text-green-600">
                                    <span className="w-2 h-2 rounded-full bg-green-500" /> Available
                                  </span>
                                  <span className="flex items-center gap-1 text-[10px] font-medium text-red-500">
                                    <span className="w-2 h-2 rounded-full bg-red-400" /> Occupied
                                  </span>
                                  <span className="flex items-center gap-1 text-[10px] font-medium text-red-500">
                                    <Lock className="w-2.5 h-2.5" /> Reserved
                                  </span>
                                </div>
                              )}
                            </div>
                            {spotsLoading ? (
                              <div className="grid grid-cols-4 gap-2">
                                {Array.from({ length: 10 }).map((_, j) => (
                                  <div key={j} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                                ))}
                              </div>
                            ) : (
                              <div className="grid grid-cols-4 gap-2">
                                {daySpots.map((spot) => {
                                  const isOwnFixed = spot.isCurrentUserFixedSpot
                                  const showAsOwn = spot.isCurrentUser || (isOwnFixed && spot.isAvailable)
                                  const isClickable = !day.isPast && (
                                    spot.isCurrentUser ||
                                    (isOwnFixed && spot.isAvailable) ||
                                    (spot.isAvailable && !spot.isFixed)
                                  )
                                  const isLoading = actionLoading === spot.id

                                  return (
                                    <motion.button
                                      type="button"
                                      key={spot.id}
                                      disabled={!isClickable || isLoading}
                                      onClick={() => isClickable && handleSpotClick(spot, day.date)}
                                      initial={{ opacity: 0, scale: 0.9 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      whileTap={isClickable ? { scale: 0.92 } : undefined}
                                      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                      className={`rounded-xl border-2 p-2 text-center transition-all relative ${
                                        showAsOwn
                                          ? 'border-blue-500 bg-blue-50 shadow-md shadow-blue-600/10'
                                          : spot.isFixedAndOccupiedByOwner
                                            ? 'border-red-400 bg-red-50'
                                            : spot.isAvailable
                                              ? 'border-green-400 bg-green-50'
                                              : 'border-red-300 bg-red-50'
                                      } ${isClickable && !isLoading ? 'active:scale-95 cursor-pointer' : ''} ${isLoading ? 'opacity-50' : ''}`}
                                    >
                                      {isLoading && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-xl">
                                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                        </div>
                                      )}
                                      <p className={`text-lg font-bold ${
                                        showAsOwn ? 'text-blue-600'
                                        : spot.isFixedAndOccupiedByOwner ? 'text-red-500'
                                        : spot.isAvailable ? 'text-green-600'
                                        : 'text-red-400'
                                      }`}>{spot.label}</p>
                                      <p className={`text-[10px] font-medium truncate ${
                                        showAsOwn ? 'text-blue-500'
                                        : spot.isFixedAndOccupiedByOwner ? 'text-red-400'
                                        : spot.isAvailable ? 'text-green-500'
                                        : 'text-red-400'
                                      }`}>
                                        {showAsOwn ? (userName?.split(' ')[0] ?? 'You')
                                          : spot.isFixedAndOccupiedByOwner ? (spot.fixedOwnerName?.split(' ')[0] ?? 'Reserved')
                                          : spot.isAvailable ? 'Available'
                                          : spot.occupantName?.split(' ')[0] ?? 'Taken'}
                                      </p>
                                      {spot.isFixedAndOccupiedByOwner && (
                                        <Lock className="w-3 h-3 text-red-400 mx-auto mt-0.5" />
                                      )}
                                      {isOwnFixed && showAsOwn && (
                                        <Lock className="w-3 h-3 text-blue-400 mx-auto mt-0.5" />
                                      )}
                                      {!spot.isFixedAndOccupiedByOwner && !showAsOwn && spot.priority === 'ev' && (
                                        <Zap className="w-3 h-3 text-green-500 mx-auto mt-0.5" />
                                      )}
                                      {!spot.isFixedAndOccupiedByOwner && !showAsOwn && spot.priority === 'motorcycle' && (
                                        <Bike className="w-3 h-3 text-orange-500 mx-auto mt-0.5" />
                                      )}
                                    </motion.button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </Card>

      {/* Confirmation modal */}
      <AnimatePresence>
        {confirmAction && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-8"
            onClick={() => setConfirmAction(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 60, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 60, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 text-center">
                <div className={`w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center ${
                  confirmAction.type === 'release' ? 'bg-red-100'
                  : confirmAction.type === 'reclaim' ? 'bg-blue-100'
                  : 'bg-green-100'
                }`}>
                  <span className={`text-xl font-bold ${
                    confirmAction.type === 'release' ? 'text-red-600'
                    : confirmAction.type === 'reclaim' ? 'text-blue-600'
                    : 'text-green-600'
                  }`}>
                    {daySpots.find(s => s.id === confirmAction.spotId)?.label}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">
                  {confirmAction.type === 'release' ? 'Release This Spot?'
                    : confirmAction.type === 'reclaim' ? 'Reclaim Your Spot?'
                    : 'Claim This Spot?'}
                </h3>
                <p className="text-sm text-slate-400">
                  {format(new Date(confirmAction.date + 'T12:00:00'), 'EEEE, MMM d')}
                </p>
              </div>
              <div className="flex border-t border-slate-100">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 py-3.5 text-sm font-semibold text-slate-500 active:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeAction}
                  disabled={!!actionLoading}
                  className={`flex-1 py-3.5 text-sm font-semibold transition-colors border-l border-slate-100 ${
                    confirmAction.type === 'release'
                      ? 'text-red-600 active:bg-red-50'
                      : 'text-blue-600 active:bg-blue-50'
                  }`}
                >
                  {actionLoading
                    ? 'Processing...'
                    : confirmAction.type === 'release' ? 'Release'
                    : confirmAction.type === 'reclaim' ? 'Reclaim'
                    : 'Claim'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
