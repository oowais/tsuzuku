import type { AccessTokenResult } from '../lib/oauth'
import type { OAuthSource } from '../lib/oauth/providers'
import type { SourceStatus } from '../db/schema'
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

// The outcome of one write. `ok` only when the source answered and said the change was applied.
export interface WriteResult {
  ok: boolean
  status: SourceStatus
  retryAfter: number | null
  error?: string
}

// One write through the wrapper (write pacing, 429 and 401 handling, no cache). `check` reads the answer and
// returns an error when the source says it did not apply the change. The answer is logged while its shape
// is unverified; write answers carry counts and list status, no secrets.
export async function sendWrite(
  opts: AdapterOptions,
  source: OAuthSource,
  fetcher: (token: string) => Promise<Response>,
  check: (data: unknown) => string | null
): Promise<WriteResult> {
  let token: string
  try {
    token = await requireToken(opts.oauth, source)
  } catch (err) {
    if (err instanceof SourceFailure) return { ok: false, status: err.status, retryAfter: err.extra.retryAfter ?? null, error: err.message }
    throw err
  }
  const res = await opts.wrapper.call<unknown>({ source, write: true, fetcher: () => fetcher(token) })
  if (res.status !== 'ok') return { ok: false, status: res.status, retryAfter: res.retryAfter, error: res.error ?? res.status }
  console.info(`[${source}] write answer: ${JSON.stringify(res.data)}`)
  const error = check(res.data)
  return error ? { ok: false, status: 'error', retryAfter: null, error } : { ok: true, status: 'ok', retryAfter: null }
}
