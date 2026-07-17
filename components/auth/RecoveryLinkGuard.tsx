'use client'

import { useEffect } from 'react'

export function RecoveryLinkGuard() {
  useEffect(() => {
    const url = new URL(window.location.href)
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
    const typeFromHash = hash.get('type')
    const typeFromQuery = url.searchParams.get('type')
    const isRecovery = typeFromHash === 'recovery' || typeFromQuery === 'recovery'

    if (!isRecovery) return
    if (url.pathname === '/reset-password') return

    // Recovery links occasionally open at `/dashboard` on mobile mail apps.
    // Preserve query/hash and route to the dedicated reset page exactly once.
    const query = url.search
    const fragment = url.hash
    window.location.replace(`/reset-password${query}${fragment}`)
  }, [])

  return null
}
