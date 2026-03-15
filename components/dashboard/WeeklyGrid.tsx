'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SpotCell } from './SpotCell'
import { Button } from '@/components/ui/Button'
import { DAY_LABELS, DAY_NAMES } from '@/lib/constants'
import { addDays, format } from 'date-fns'
import { ChevronLeft, ChevronRight, LogOut, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ParkingSpot, Profile, WeeklyAllocation } from '@/types/db'

interface WeeklyGridProps {
  userId: string
  initialSpots: ParkingSpot[]
  initialAllocations: (WeeklyAllocation & { user: Profile })[]
  initialWeekStart: string
}

function GridSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[80px_repeat(5,1fr)] gap-2">
          <div className="h-14 rounded-xl bg-slate-100 animate-pulse" />
          {Array.from({ length: 5 }).map((_, j) => (
            <div key={j} className="h-14 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function WeeklyGrid({
  userId,
  initialSpots,
  initialAllocations,
  initialWeekStart,
}: WeeklyGridProps) {
  const [spots] = useState<ParkingSpot[]>(initialSpots)
  const [allocations, setAllocations] = useState(initialAllocations)
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const weekDates = Array.from({ length: 5 }, (_, i) =>
    format(addDays(new Date(weekStart), i), 'yyyy-MM-dd')
  )

  const fetchAllocations = useCallback(async (ws: string) => {
    setLoading(true)
    const dates = Array.from({ length: 5 }, (_, i) =>
      format(addDays(new Date(ws), i), 'yyyy-MM-dd')
    )
    const { data } = await supabase
      .from('weekly_allocations')
      .select('*, user:profiles(*)')
      .in('date', dates)

    if (data) {
      setAllocations(data as (WeeklyAllocation & { user: Profile })[])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    const channel = supabase
      .channel('allocations-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'weekly_allocations' },
        () => {
          fetchAllocations(weekStart)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, weekStart, fetchAllocations])

  const navigateWeek = (direction: number) => {
    if (navigator.vibrate) navigator.vibrate(10)
    const newStart = format(
      addDays(new Date(weekStart), direction * 7),
      'yyyy-MM-dd'
    )
    setWeekStart(newStart)
    fetchAllocations(newStart)
  }

  const handleRelease = async (date: string, spotId: number) => {
    if (navigator.vibrate) navigator.vibrate(10)
    setLoading(true)
    await fetch('/api/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, spot_id: spotId, user_id: userId }),
    })
    await fetchAllocations(weekStart)
  }

  const getOccupant = (spotId: number, date: string) => {
    return allocations.find((a) => a.spot_id === spotId && a.date === date)
  }

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigateWeek(-1)}
          className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center active:scale-[0.95] transition-all duration-200 touch-manipulation haptic-feedback"
        >
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>
        <h2 className="text-sm font-semibold text-slate-700">
          Week of {format(new Date(weekStart), 'MMM d, yyyy')}
        </h2>
        <button
          onClick={() => navigateWeek(1)}
          className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center active:scale-[0.95] transition-all duration-200 touch-manipulation haptic-feedback"
        >
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>
      </div>

      {/* Grid */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <GridSkeleton />
          </motion.div>
        ) : (
          <motion.div
            key={weekStart}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-x-auto -mx-4 px-4"
          >
            <div className="min-w-[640px]">
              {/* Day headers */}
              <div className="grid grid-cols-[80px_repeat(5,1fr)] gap-2 mb-3">
                <div className="text-xs font-medium text-slate-400 px-1">Spot</div>
                {weekDates.map((date, i) => (
                  <div key={date} className="text-center">
                    <p className="text-xs font-semibold text-slate-700">{DAY_LABELS[DAY_NAMES[i]]}</p>
                    <p className="text-[10px] text-slate-400">{format(new Date(date), 'MMM d')}</p>
                  </div>
                ))}
              </div>

              {/* Spot rows */}
              {spots.map((spot, spotIndex) => (
                <motion.div
                  key={spot.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: spotIndex * 0.03, duration: 0.3, ease: [0.175, 0.885, 0.32, 1.275] }}
                  className="grid grid-cols-[80px_repeat(5,1fr)] gap-2 mb-2"
                >
                  <div className="flex items-center px-1">
                    <span className="text-sm font-bold text-slate-600">#{spot.label}</span>
                  </div>

                  {weekDates.map((date) => {
                    const alloc = getOccupant(spot.id, date)
                    const occupantName = alloc?.user?.full_name ?? null
                    const isCurrentUser = alloc?.user_id === userId
                    const isFixed = !!spot.fixed_user_id

                    return (
                      <div key={date} className="relative">
                        <SpotCell
                          label={spot.label}
                          priority={spot.priority}
                          occupantName={occupantName}
                          isFixed={isFixed}
                          isCurrentUser={isCurrentUser}
                        />
                        {isCurrentUser && isFixed && (
                          <button
                            onClick={() => handleRelease(date, spot.id)}
                            className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md hover:bg-red-600 active:scale-90 transition-all duration-200 touch-manipulation"
                            title="Release this spot"
                          >
                            <LogOut className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
