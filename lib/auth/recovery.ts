export type RecoveryUrlParams = {
  code: string | null
  tokenHash: string | null
  type: string | null
  accessToken: string | null
  refreshToken: string | null
  authError: string | null
}

export function parseRecoveryUrl(href: string): RecoveryUrlParams {
  const url = new URL(href)
  const query = url.searchParams
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))

  return {
    code: query.get('code'),
    tokenHash: query.get('token_hash'),
    type: query.get('type') ?? hash.get('type'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    authError: query.get('error_description') ?? query.get('error') ?? hash.get('error_description') ?? hash.get('error'),
  }
}

export function hasRecoveryParams(params: RecoveryUrlParams): boolean {
  return Boolean(
    params.code ||
      (params.tokenHash && params.type === 'recovery') ||
      (params.accessToken && params.refreshToken) ||
      params.authError
  )
}

export function cleanResetPasswordUrl(): void {
  window.history.replaceState(null, '', '/reset-password')
}

export async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
