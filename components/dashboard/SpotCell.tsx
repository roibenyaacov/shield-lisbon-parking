'use client'

import { cn } from '@/lib/utils'
import { Zap, Bike, Lock, User } from 'lucide-react'
import { motion } from 'framer-motion'
import type { SpotPriority } from '@/types/db'

interface SpotCellProps {
  label: string
  priority: SpotPriority
  occupantName: string | null
  isFixed: boolean
  isCurrentUser: boolean
}

const priorityConfig: Record<SpotPriority, { icon: typeof Zap; color: string; bg: string; label: string }> = {
  ev: { icon: Zap, color: 'text-green-600', bg: 'bg-green-50', label: 'EV' },
  motorcycle: { icon: Bike, color: 'text-orange-600', bg: 'bg-orange-50', label: 'Moto' },
  general: { icon: User, color: 'text-slate-500', bg: 'bg-slate-50', label: '' },
}

export function SpotCell({ label, priority, occupantName, isFixed, isCurrentUser }: SpotCellProps) {
  const config = priorityConfig[priority]
  const Icon = config.icon

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.175, 0.885, 0.32, 1.275] }}
      className={cn(
        'relative rounded-2xl border px-3 py-2.5 text-xs transition-all duration-200 min-h-[60px] flex flex-col justify-center',
        occupantName
          ? isCurrentUser
            ? 'border-blue-500/30 bg-blue-50/80 shadow-sm shadow-blue-600/10'
            : 'border-slate-200 bg-white'
          : 'border-dashed border-slate-200 bg-slate-50/50'
      )}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-bold text-slate-700">#{label}</span>
        <div className="flex items-center gap-1">
          {priority !== 'general' && (
            <span className={cn('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium', config.bg, config.color)}>
              <Icon className="w-3 h-3" />
              {config.label}
            </span>
          )}
          {isFixed && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600">
              <Lock className="w-3 h-3" />
            </span>
          )}
        </div>
      </div>
      <p className={cn(
        'text-[11px] truncate',
        occupantName ? 'text-slate-900 font-medium' : 'text-slate-400 italic'
      )}>
        {occupantName ?? 'Available'}
      </p>
    </motion.div>
  )
}
