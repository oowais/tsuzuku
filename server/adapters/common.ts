import type { AccessTokenResult } from '../lib/oauth'
import type { OAuthSource } from '../lib/oauth/providers'
import { SourceFailure, type createSourceWrapper } from '../lib/source-wrapper'

export interface AdapterOptions {
  wrapper: ReturnType<typeof createSourceWrapper>
  oauth: { getAccessToken: (source: OAuthSource) => Promise<AccessTokenResult> }
  env?: NodeJS.ProcessEnv
  fetch?: typeof globalThis.fetch
}

// Inside `run`: returns a usable token or aborts the read with the matching source status.
export async function requireToken(oauth: AdapterOptions['oauth'], source: OAuthSource): Promise<string> {
  const res = await oauth.getAccessToken(source)
  if (res.ok) return res.token
  switch (res.reason) {
    case 'rate_limited':
      throw new SourceFailure('rate_limited', { retryAfter: res.retryAfter })
    case 'auth_expired':
      throw new SourceFailure('auth_expired', { error: res.error ?? 'Reconnect needed' })
    case 'not_connected':
      throw new SourceFailure('error', { error: 'Not connected' })
    default:
      throw new SourceFailure('error', { error: res.error ?? 'Could not get an access token' })
  }
}

// Pages are followed until the source says there are no more; this only guards against a loop.
export const MAX_PAGES = 50
