'use client'

import { useEffect } from 'react'
import { hasRecoveryParams, parseRecoveryUrl } from '@/lib/auth/recovery'

export function RecoveryLinkGuard() {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.pathname === '/reset-password') return

    const params = parseRecoveryUrl(window.location.href)
    if (!hasRecoveryParams(params)) return

    // Recovery links occasionally open on `/dashboard` or `/` in mobile mail apps.
    // Preserve query/hash and route to the dedicated reset page exactly once.
    window.location.replace(`/reset-password${url.search}${url.hash}`)
  }, [])

  return null
}
