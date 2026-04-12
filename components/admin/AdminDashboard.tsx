'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import {
  ChevronLeft, ChevronRight, Zap, Bike, Lock, Clock,
  Users, BarChart2, RefreshCw,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format, addDays, startOfWeek, addWeeks } from 'date-fns'
import { DAY_NAMES, DAY_LABELS, TEAM_LABELS } from '@/lib/constants'
import type { ParkingSpot, Profile, WeeklyAllocation, Waitlist, WeeklyRequest } from '@/types/db'

interface AdminDashboardProps {
  adminName: string
}

interface SlotInfo {
  spotId: number
  spotLabel: string
  spotPriority: string
  isFixed: boolean
  fixedOwnerName: string | null
  isFixedAndOccupiedByOwner: boolean
  occupantName: string | null
  occupantTeam: string | null
  isEmpty: boolean
}

interface DayData {
  date: string
  dayLabel: string
  slots: SlotInfo[]
  waitlist: { name: string; team: string | null }[]
}

interface UserRequest {
  userId: string
  name: string
  team: string | null
  days: string[]
  allocatedDays: string[]
  waitlistedDays: string[]
}

export function AdminDashboard({ adminName }: AdminDashboardProps) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [direction, setDirection] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [days, setDays] = useState<DayData[]>([])
  const [requests, setRequests] = useState<UserRequest[]>([])
  const [spots, setSpots] = useState<ParkingSpot[]>([])
  const supabase = createClient()

  const monday = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset)
  const friday = addDays(monday, 4)
  const weekDates = DAY_NAMES.map((_, i) => format(addDays(monday, i), 'yyyy-MM-dd'))
  const weekLabel =
    weekOffset === 0 ? 'This Week' :
    weekOffset === 1 ? 'Next Week' :
    weekOffset === -1 ? 'Last Week' :
    `${format(monday, 'MMM d')} – ${format(friday, 'MMM d')}`

  const loadWeek = useCallback(async () => {
    setLoading(true)
    const dates = DAY_NAMES.map((_, i) => format(addDays(monday, i), 'yyyy-MM-dd'))

    const [spotsRes, allocsRes, waitlistRes, requestsRes, profilesRes] = await Promise.all([
      supabase.from('parking_spots').select('*, fixed_user:profiles!parking_spots_fixed_user_id_fkey(full_name)').eq('is_active', true).order('label'),
      supabase.from('weekly_allocations').select('*, user:profiles(*)').in('date', dates),
      supabase.from('waitlist').select('*, user:profiles(*)').in('date', dates).order('created_at'),
      supabase.from('weekly_requests').select('*').eq('week_start', dates[0]),
      supabase.from('profiles').select('*').eq('is_active', true),
    ])

    const allSpots = (spotsRes.data ?? []) as (ParkingSpot & { fixed_user: { full_name: string } | null })[]
    const allAllocs = (allocsRes.data ?? []) as (WeeklyAllocation & { user: Profile })[]
    const allWaitlist = (waitlistRes.data ?? []) as (Waitlist & { user: Profile })[]
    const allRequests = (requestsRes.data ?? []) as WeeklyRequest[]
    const allProfiles = (profilesRes.data ?? []) as Profile[]

    setSpots(allSpots)

    const dayDataArr: DayData[] = DAY_NAMES.map((dayName, i) => {
      const date = dates[i]
      const dayAllocs = allAllocs.filter(a => a.date === date)
      const dayWaitlist = allWaitlist.filter(w => w.date === date)

      const slots: SlotInfo[] = allSpots.map(spot => {
        const alloc = dayAllocs.find(a => a.spot_id === spot.id)
        const isReserved = !!spot.fixed_user_id || !!spot.reserved_name
        return {
          spotId: spot.id,
          spotLabel: spot.label,
          spotPriority: spot.priority,
          isFixed: isReserved,
          fixedOwnerName: spot.fixed_user?.full_name ?? spot.reserved_name ?? null,
          isFixedAndOccupiedByOwner: isReserved && (!alloc || alloc?.user_id === spot.fixed_user_id),
          occupantName: alloc?.user?.full_name ?? null,
          occupantTeam: alloc?.user?.team ?? null,
          isEmpty: !alloc,
        }
      })

      const waitlist = dayWaitlist.map(w => ({
        name: w.user?.full_name ?? 'Unknown',
        team: w.user?.team ?? null,
      }))

      return { date, dayLabel: DAY_LABELS[dayName], slots, waitlist }
    })

    setDays(dayDataArr)

    // Build per-user request summary
    const userSummary: UserRequest[] = allProfiles
      .filter(p => {
        const req = allRequests.find(r => r.user_id === p.id)
        if (!req) return false
        return req.mon || req.tue || req.wed || req.thu || req.fri
      })
      .map(p => {
        const req = allRequests.find(r => r.user_id === p.id)!
        const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri'] as const
        const requestedDays = dayKeys
          .map((k, i) => req[k] ? dates[i] : null)
          .filter(Boolean) as string[]

        const allocatedDays = allAllocs
          .filter(a => a.user_id === p.id)
          .map(a => a.date)

        const waitlistedDays = allWaitlist
          .filter(w => w.user_id === p.id)
          .map(w => w.date)

        return {
          userId: p.id,
          name: p.full_name ?? p.email ?? 'Unknown',
          team: p.team,
          days: requestedDays,
          allocatedDays,
          waitlistedDays,
        }
      })
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

    setRequests(userSummary)
    setLastRefresh(new Date())
    setLoading(false)
  }, [weekOffset])

  useEffect(() => {
    loadWeek()
  }, [loadWeek])

  useEffect(() => {
    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_allocations' }, loadWeek)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist' }, loadWeek)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_requests' }, loadWeek)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, loadWeek])

  const goToWeek = (dir: number) => {
    setDirection(dir)
    setWeekOffset(prev => prev + dir)
  }

  const totalAllocated = days.reduce((sum, d) => sum + d.slots.filter(s => !s.isEmpty).length, 0)
  const totalEmpty = days.reduce((sum, d) => sum + d.slots.filter(s => s.isEmpty).length, 0)
  const totalWaiting = days.reduce((sum, d) => sum + d.waitlist.length, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="text-sm text-slate-500">
            Signed in as <span className="font-medium text-slate-700">{adminName}</span>
          </p>
        </div>
        <button
          onClick={loadWeek}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {format(lastRefresh, 'HH:mm')}
        </button>
      </div>

      {/* Summary pills */}
      <div className="grid grid-cols-3 gap-3">
        <Card padding="md" className="text-center">
          <div className="text-2xl font-bold text-blue-600">{totalAllocated}</div>
          <div className="text-xs text-slate-500 mt-0.5">Allocated</div>
        </Card>
        <Card padding="md" className="text-center">
          <div className="text-2xl font-bold text-slate-400">{totalEmpty}</div>
          <div className="text-xs text-slate-500 mt-0.5">Empty slots</div>
        </Card>
        <Card padding="md" className="text-center">
          <div className="text-2xl font-bold text-amber-500">{totalWaiting}</div>
          <div className="text-xs text-slate-500 mt-0.5">Waitlisted</div>
        </Card>
      </div>

      {/* Week navigation */}
      <Card padding="lg">
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => goToWeek(-1)}
            disabled={weekOffset <= -4}
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all touch-manipulation disabled:opacity-20"
          >
            <ChevronLeft className="w-5 h-5 text-slate-500" />
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
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all touch-manipulation disabled:opacity-20"
          >
            <ChevronRight className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={weekOffset}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
          >
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {days.map((day, di) => (
                  <motion.div
                    key={day.date}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: di * 0.04, type: 'spring', stiffness: 300, damping: 25 }}
                  >
                    {/* Day header */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-700">{day.dayLabel}</span>
                        <span className="text-[10px] text-slate-400">
                          {format(new Date(day.date + 'T12:00:00'), 'MMM d')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-green-600">
                          {day.slots.filter(s => !s.isEmpty).length}/{day.slots.length} filled
                        </span>
                        {day.waitlist.length > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                            <Clock className="w-3 h-3" />
                            {day.waitlist.length} waiting
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Spot grid */}
                    <div className="grid grid-cols-5 gap-1.5">
                      {day.slots.map(slot => (
                        <div
                          key={slot.spotId}
                          className={`rounded-xl p-2 text-center border ${
                            slot.isFixedAndOccupiedByOwner
                              ? 'border-red-300 bg-red-50'
                              : slot.isFixed && !slot.isEmpty
                                ? 'border-blue-200 bg-blue-50'
                                : !slot.isEmpty
                                  ? 'border-blue-200 bg-blue-50'
                                  : 'border-slate-100 bg-slate-50'
                          }`}
                        >
                          <div className={`text-sm font-bold ${
                            slot.isFixedAndOccupiedByOwner ? 'text-red-600'
                            : !slot.isEmpty ? 'text-blue-700'
                            : 'text-slate-300'
                          }`}>
                            {slot.spotLabel}
                          </div>
                          <div className="flex items-center justify-center gap-0.5 mt-0.5">
                            {slot.isFixedAndOccupiedByOwner && (
                              <Lock className="w-2.5 h-2.5 text-red-400 flex-shrink-0" />
                            )}
                            {!slot.isFixedAndOccupiedByOwner && slot.spotPriority === 'ev' && (
                              <Zap className="w-2.5 h-2.5 text-green-400 flex-shrink-0" />
                            )}
                            {!slot.isFixedAndOccupiedByOwner && slot.spotPriority === 'motorcycle' && (
                              <Bike className="w-2.5 h-2.5 text-orange-400 flex-shrink-0" />
                            )}
                          </div>
                          <div className={`text-[9px] leading-tight mt-0.5 font-medium truncate ${
                            slot.isFixedAndOccupiedByOwner ? 'text-red-500'
                            : slot.isEmpty ? 'text-slate-300'
                            : 'text-slate-600'
                          }`}>
                            {slot.isFixedAndOccupiedByOwner
                              ? (slot.fixedOwnerName?.split(' ')[0] ?? 'Reserved')
                              : slot.isEmpty
                                ? '—'
                                : slot.occupantName?.split(' ')[0] ?? '?'}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Waitlist */}
                    {day.waitlist.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">
                          Waitlist:
                        </span>
                        {day.waitlist.map((w, wi) => (
                          <span
                            key={wi}
                            className="text-[10px] font-medium bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full border border-amber-200"
                          >
                            {wi + 1}. {w.name.split(' ')[0]}
                          </span>
                        ))}
                      </div>
                    )}

                    {di < days.length - 1 && (
                      <div className="border-b border-slate-100 mt-3" />
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </Card>

      {/* User request summary */}
      {requests.length > 0 && (
        <Card padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-slate-500" />
            <h3 className="font-bold text-slate-900 text-sm">
              Requests this week ({requests.length})
            </h3>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            {[
              { color: 'bg-green-500', label: 'Allocated' },
              { color: 'bg-amber-400', label: 'Waitlisted' },
              { color: 'bg-slate-200', label: 'Requested' },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1 text-[10px] font-medium text-slate-500">
                <span className={`w-2 h-2 rounded-sm ${color}`} />
                {label}
              </span>
            ))}
          </div>

          <div className="space-y-2">
            {requests.map(req => (
              <div key={req.userId} className="flex items-center gap-3">
                <div className="w-24 min-w-[6rem]">
                  <p className="text-xs font-semibold text-slate-800 truncate">{req.name.split(' ')[0]}</p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {req.team ? TEAM_LABELS[req.team as keyof typeof TEAM_LABELS] : ''}
                  </p>
                </div>
                <div className="flex gap-1 flex-1">
                  {weekDates.map((date, di) => {
                    const isRequested = req.days.includes(date)
                    const isAllocated = req.allocatedDays.includes(date)
                    const isWaitlisted = req.waitlistedDays.includes(date)
                    const dayInitial = ['M', 'T', 'W', 'T', 'F'][di]

                    if (!isRequested) {
                      return (
                        <div key={date} className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center">
                          <span className="text-[9px] text-slate-200">{dayInitial}</span>
                        </div>
                      )
                    }
                    return (
                      <div
                        key={date}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                          isAllocated
                            ? 'bg-green-500'
                            : isWaitlisted
                              ? 'bg-amber-400'
                              : 'bg-slate-200'
                        }`}
                        title={isAllocated ? 'Allocated' : isWaitlisted ? 'Waitlisted' : 'Requested'}
                      >
                        <span className={`text-[9px] font-bold ${
                          isAllocated || isWaitlisted ? 'text-white' : 'text-slate-500'
                        }`}>
                          {dayInitial}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="text-[10px] text-right min-w-[2.5rem]">
                  <span className="font-bold text-green-600">{req.allocatedDays.length}</span>
                  <span className="text-slate-300">/</span>
                  <span className="text-slate-400">{req.days.length}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!loading && requests.length === 0 && (
        <Card padding="lg">
          <div className="text-center py-6">
            <BarChart2 className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No requests for this week yet</p>
          </div>
        </Card>
      )}
    </div>
  )
}
