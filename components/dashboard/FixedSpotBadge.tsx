'use client'

import { Card } from '@/components/ui/Card'
import { Lock, Info } from 'lucide-react'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface FixedSpotBadgeProps {
  spotLabel: string
}

export function FixedSpotBadge({ spotLabel }: FixedSpotBadgeProps) {
  const [showInfo, setShowInfo] = useState(false)

  return (
    <Card padding="md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/20">
            <span className="text-white text-sm font-bold">#{spotLabel}</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-sm font-semibold text-slate-900">Fixed Spot</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Tap days below to release or reclaim</p>
          </div>
        </div>
        <button
          onClick={() => setShowInfo(prev => !prev)}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 active:scale-90 transition-all touch-manipulation"
        >
          <Info className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="overflow-hidden"
          >
            <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100 leading-relaxed">
              Your spot is reserved by default. Release it for specific days to make it
              available for others. If someone is on the waitlist, they'll automatically
              get your spot. Reclaim it anytime if it's still available.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
