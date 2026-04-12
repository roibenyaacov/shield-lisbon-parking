'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { CheckCircle2, Clock, CalendarDays, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format, addDays, startOfWeek, addWeeks, isBefore, startOfDay, isToday, isWeekend } from 'date-fns'
import toast from 'react-hot-toast'

interface ReleaseManagerProps {
  userId: string
  spotId: number
  spotLabel: string
}

type ReleaseMode = null | 'full-day' | 'multi-day'

export function ReleaseManager({ userId, spotId, spotLabel }: ReleaseManagerProps) {
  const [mode, setMode] = useState<ReleaseMode>(null)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [releasing, setReleasing] = useState(false)
  const [calendarOffset, setCalendarOffset] = useState(0)

  const today = startOfDay(new Date())
  const monday = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), calendarOffset)

  const weekdays = Array.from({ length: 5 }, (_, i) => {
    const d = addDays(monday, i)
    return {
      date: format(d, 'yyyy-MM-dd'),
      label: format(d, 'EEE'),
      full: format(d, 'MMM d'),
      isPast: isBefore(d, today),
      isToday: isToday(d),
    }
  })

  const toggleDate = (date: string) => {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  const handleRelease = async () => {
    if (selectedDates.size === 0) return
    setReleasing(true)

    let successCount = 0
    let errorCount = 0

    for (const date of selectedDates) {
      try {
        const res = await fetch('/api/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date,
            spot_id: spotId,
            user_id: userId,
            action: 'release',
          }),
        })
        if (res.ok) successCount++
        else errorCount++
      } catch {
        errorCount++
      }
    }

    if (successCount > 0) {
      toast.success(`Released spot #${spotLabel} for ${successCount} day${successCount > 1 ? 's' : ''}`)
    }
    if (errorCount > 0) {
      toast.error(`Failed to release ${errorCount} day${errorCount > 1 ? 's' : ''}`)
    }

    setSelectedDates(new Set())
    setMode(null)
    setReleasing(false)
  }

  return (
    <>
      <Card padding="md">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Release Parking
        </p>
        <p className="text-xs text-slate-400 mb-4">
          Choose how you want to release your parking spot:
        </p>
        <div className="space-y-2">
          <button
            onClick={() => setMode('full-day')}
            className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all active:scale-[0.98] touch-manipulation"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-900">Full Day</p>
              <p className="text-xs text-slate-400 mt-0.5">Parking will be available all day</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-blue-400" />
          </button>

          <button
            onClick={() => setMode('multi-day')}
            className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all active:scale-[0.98] touch-manipulation"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-900">Multiple Days</p>
              <p className="text-xs text-slate-400 mt-0.5">Release for vacation or multiple days</p>
            </div>
            <CalendarDays className="w-5 h-5 text-blue-400" />
          </button>
        </div>
      </Card>

      {/* Day picker modal */}
      <AnimatePresence>
        {mode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-8"
            onClick={() => { setMode(null); setSelectedDates(new Set()) }}
          >
            <motion.div
              initial={{ opacity: 0, y: 60, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 60, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">
                  {mode === 'full-day' ? 'Release for a Day' : 'Release Multiple Days'}
                </h3>
                <button
                  onClick={() => { setMode(null); setSelectedDates(new Set()) }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 active:scale-90 transition-all"
                >
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              {/* Week navigation */}
              <div className="px-5 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setCalendarOffset(prev => Math.max(0, prev - 1))}
                    disabled={calendarOffset <= 0}
                    className="w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 disabled:opacity-20 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-500" />
                  </button>
                  <p className="text-sm font-semibold text-slate-700">
                    {calendarOffset === 0 ? 'This Week' : calendarOffset === 1 ? 'Next Week' : format(monday, 'MMM d')} — {format(addDays(monday, 4), 'MMM d')}
                  </p>
                  <button
                    onClick={() => setCalendarOffset(prev => Math.min(4, prev + 1))}
                    disabled={calendarOffset >= 4}
                    className="w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 disabled:opacity-20 transition-all"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  </button>
                </div>

                <p className="text-xs text-slate-400 mb-3">
                  {mode === 'full-day'
                    ? 'Select a day to release your parking spot:'
                    : 'Select the days you want to release:'}
                </p>

                {/* Day buttons */}
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {weekdays.map(day => {
                    const isSelected = selectedDates.has(day.date)
                    return (
                      <button
                        key={day.date}
                        disabled={day.isPast}
                        onClick={() => {
                          if (mode === 'full-day') {
                            setSelectedDates(new Set([day.date]))
                          } else {
                            toggleDate(day.date)
                          }
                        }}
                        className={`flex flex-col items-center p-2.5 rounded-xl border-2 transition-all active:scale-95 touch-manipulation ${
                          day.isPast
                            ? 'opacity-30 border-slate-100'
                            : isSelected
                              ? 'border-blue-500 bg-blue-50 shadow-sm'
                              : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <span className={`text-[10px] font-bold uppercase ${
                          isSelected ? 'text-blue-600' : 'text-slate-400'
                        }`}>{day.label}</span>
                        <span className={`text-sm font-bold mt-0.5 ${
                          isSelected ? 'text-blue-600' : 'text-slate-700'
                        }`}>{day.full.split(' ')[1]}</span>
                        {day.isToday && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="flex border-t border-slate-100">
                <button
                  onClick={() => { setMode(null); setSelectedDates(new Set()) }}
                  className="flex-1 py-3.5 text-sm font-semibold text-slate-500 active:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRelease}
                  disabled={selectedDates.size === 0 || releasing}
                  className="flex-1 py-3.5 text-sm font-semibold text-red-600 active:bg-red-50 transition-colors border-l border-slate-100 disabled:opacity-30"
                >
                  {releasing
                    ? 'Releasing...'
                    : `Release ${selectedDates.size > 0 ? `(${selectedDates.size})` : ''}`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
