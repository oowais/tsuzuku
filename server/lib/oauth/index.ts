import { createHash, randomBytes } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, type Db } from '../../db'
import { oauthStates, sourceAccounts } from '../../db/schema'
import { decrypt, encrypt, loadKey } from '../crypto'
import { appUrl, clientCredentials } from '../env'
import { createSourceWrapper, useSourceWrapper } from '../source-wrapper'
import { USER_ID } from '../user'
import { PROVIDERS, USER_AGENT, type OAuthSource } from './providers'

export const STATE_TTL_MS = 10 * 60 * 1000
// Refresh this long before expiry so a request never goes out with a token about to lapse.
export const REFRESH_MARGIN_MS = 5 * 60 * 1000

// Only access_token is relied on. Everything else is optional until real responses confirm it.
const tokenResponse = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional()
})
type TokenResponse = z.infer<typeof tokenResponse>

export type AuthFailure = 'not_connected' | 'auth_expired' | 'rate_limited' | 'error'
export type AccessTokenResult
  = | { ok: true, token: string }
    | { ok: false, reason: AuthFailure, retryAfter?: number, error?: string }

export class OAuthFlowError extends Error {
  constructor(public code: 'invalid_state' | 'denied' | 'exchange_failed' | 'rate_limited', message: string) {
    super(message)
  }
}

export interface OAuthOptions {
  db: Db
  wrapper?: ReturnType<typeof createSourceWrapper>
  fetch?: typeof globalThis.fetch
  env?: NodeJS.ProcessEnv
  now?: () => number
  userId?: number
}

export function createOAuth(opts: OAuthOptions) {
  const { db } = opts
  const userId = opts.userId ?? USER_ID
  const now = opts.now ?? Date.now
  const env = opts.env ?? process.env
  const doFetch = opts.fetch ?? globalThis.fetch
  const wrapper = opts.wrapper ?? createSourceWrapper({ db, userId, now })
  const refreshing = new Map<OAuthSource, Promise<AccessTokenResult>>()

  const redirectUri = (source: OAuthSource) => `${appUrl(env)}/api/auth/${source}/callback`
  const accountWhere = (source: OAuthSource) => and(eq(sourceAccounts.userId, userId), eq(sourceAccounts.source, source))

  // Posts to the token endpoint through the source wrapper, so 429s and blocks apply here too.
  async function requestToken(source: OAuthSource, params: Record<string, string>) {
    const provider = PROVIDERS[source]
    const creds = clientCredentials(source, env)
    const body: Record<string, string> = { ...params, client_id: creds.clientId }
    if (creds.clientSecret) body.client_secret = creds.clientSecret
    const res = await wrapper.call<TokenResponse>({
      source,
      fetcher: () => doFetch(provider.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': provider.bodyFormat === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
          ...provider.headers(creds)
        },
        body: provider.bodyFormat === 'json' ? JSON.stringify(body) : new URLSearchParams(body).toString()
      }),
      parse: async (r) => {
        const raw = await r.json()
        // Field names only, never values, to confirm the real response shape. Scope is not secret.
        if (raw && typeof raw === 'object') {
          const scope = typeof raw.scope === 'string' ? ` (scope: ${raw.scope})` : ''
          console.info(`[oauth] ${source} token response fields: ${Object.keys(raw).sort().join(', ')}${scope}`)
        }
        return tokenResponse.parse(raw)
      }
    })
    return res
  }

  // One UPDATE writes access token, refresh token and expiry together, so a crash can never
  // leave a new access token paired with a refresh token the source has already invalidated.
  function saveTokens(source: OAuthSource, tokens: TokenResponse, previousRefreshEnc: string | null) {
    const key = loadKey(env.TOKEN_ENC_KEY)
    db.update(sourceAccounts).set({
      accessTokenEnc: encrypt(tokens.access_token, key),
      refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token, key) : previousRefreshEnc,
      expiresAt: tokens.expires_in ? new Date(now() + tokens.expires_in * 1000) : null,
      lastStatus: 'ok',
      lastError: null
    }).where(accountWhere(source)).run()
  }

  function start(source: OAuthSource) {
    const provider = PROVIDERS[source]
    const creds = clientCredentials(source, env)
    const state = randomBytes(32).toString('base64url')
    // 64 random bytes give an 86-character verifier from the unreserved set, within the 43 to 128 both sources allow.
    const codeVerifier = provider.pkce ? randomBytes(64).toString('base64url') : null

    db.delete(oauthStates).where(lt(oauthStates.createdAt, new Date(now() - STATE_TTL_MS))).run()
    db.insert(oauthStates).values({ userId, source, state, codeVerifier, createdAt: new Date(now()) }).run()

    const url = new URL(provider.authorizeUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', creds.clientId)
    url.searchParams.set('redirect_uri', redirectUri(source))
    url.searchParams.set('state', state)
    if (provider.scope) url.searchParams.set('scope', provider.scope)
    if (codeVerifier) {
      const challenge = provider.pkce === 'S256' ? createHash('sha256').update(codeVerifier).digest('base64url') : codeVerifier
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', provider.pkce!)
    }
    return { url: url.toString(), state }
  }

  async function complete(source: OAuthSource, query: { code?: string, state?: string, error?: string }, cookieState: string | undefined) {
    if (query.error) throw new OAuthFlowError('denied', `Authorization was not granted (${query.error})`)
    if (!query.state || !query.code || !cookieState || query.state !== cookieState) {
      throw new OAuthFlowError('invalid_state', 'State is missing or does not match this browser')
    }

    // Delete first so a state can never be used twice, even if the exchange below fails.
    const row = db.delete(oauthStates)
      .where(and(eq(oauthStates.userId, userId), eq(oauthStates.source, source), eq(oauthStates.state, query.state)))
      .returning().get()
    if (!row || row.createdAt.getTime() < now() - STATE_TTL_MS) {
      throw new OAuthFlowError('invalid_state', 'State is unknown, expired or already used')
    }

    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: redirectUri(source)
    }
    if (row.codeVerifier) params.code_verifier = row.codeVerifier

    const res = await requestToken(source, params)
    if (res.status === 'rate_limited') throw new OAuthFlowError('rate_limited', `Rate limited, retry in ${res.retryAfter}s`)
    if (!res.data) throw new OAuthFlowError('exchange_failed', res.error ?? 'Token exchange failed')

    db.insert(sourceAccounts).values({ userId, source }).onConflictDoNothing().run()
    saveTokens(source, res.data, null)
  }

  async function refresh(source: OAuthSource, refreshTokenEnc: string): Promise<AccessTokenResult> {
    const key = loadKey(env.TOKEN_ENC_KEY)
    const params: Record<string, string> = { grant_type: 'refresh_token', refresh_token: decrypt(refreshTokenEnc, key) }
    // Trakt's docs list redirect_uri as required on refresh; MAL does not ask for it.
    if (source === 'trakt') params.redirect_uri = redirectUri(source)

    const res = await requestToken(source, params)
    // Each refresh goes to the log (#92), never the tokens: when it happened, until when, or why it failed.
    if (res.status === 'ok' && res.data) {
      saveTokens(source, res.data, refreshTokenEnc)
      const until = res.data.expires_in ? new Date(now() + res.data.expires_in * 1000).toISOString() : 'no expiry given'
      console.info(`[oauth] ${source} token refreshed, expires ${until}${res.data.refresh_token ? ', new refresh token' : ''}`)
      return { ok: true, token: res.data.access_token }
    }
    if (res.status === 'rate_limited') {
      console.warn(`[oauth] ${source} token refresh rate limited, retry in ${res.retryAfter ?? '?'} s`)
      return { ok: false, reason: 'rate_limited', retryAfter: res.retryAfter ?? undefined }
    }
    // 400 and 401 mean the refresh token was rejected: the user has to reconnect.
    if (res.httpStatus === 400 || res.httpStatus === 401) {
      db.update(sourceAccounts).set({ lastStatus: 'auth_expired', lastError: res.error ?? null }).where(accountWhere(source)).run()
      console.warn(`[oauth] ${source} refresh token rejected (${res.error ?? `HTTP ${res.httpStatus}`}): reconnect ${source}`)
      return { ok: false, reason: 'auth_expired', error: res.error }
    }
    // Network errors and 5xx keep the tokens and report a plain error; the next call retries.
    console.warn(`[oauth] ${source} token refresh failed, will retry: ${res.error ?? 'unknown error'}`)
    return { ok: false, reason: 'error', error: res.error }
  }

  // Returns a usable access token, refreshing it first when it is close to expiry.
  async function getAccessToken(source: OAuthSource): Promise<AccessTokenResult> {
    const acct = db.select().from(sourceAccounts).where(accountWhere(source)).get()
    if (!acct?.accessTokenEnc) return { ok: false, reason: 'not_connected' }
    if (acct.lastStatus === 'auth_expired') return { ok: false, reason: 'auth_expired' }

    const key = loadKey(env.TOKEN_ENC_KEY)
    const fresh = !acct.expiresAt || acct.expiresAt.getTime() - now() > REFRESH_MARGIN_MS
    if (fresh) return { ok: true, token: decrypt(acct.accessTokenEnc, key) }

    if (!acct.refreshTokenEnc) {
      db.update(sourceAccounts).set({ lastStatus: 'auth_expired', lastError: 'Token expired and cannot be refreshed' }).where(accountWhere(source)).run()
      console.warn(`[oauth] ${source} token expired and has no refresh token: reconnect ${source}`)
      return { ok: false, reason: 'auth_expired' }
    }

    // Concurrent callers share one refresh; a second refresh would use a token the first just invalidated.
    let pending = refreshing.get(source)
    if (!pending) {
      pending = refresh(source, acct.refreshTokenEnc).finally(() => refreshing.delete(source))
      refreshing.set(source, pending)
    }
    return pending
  }

  return { start, complete, getAccessToken, redirectUri }
}

let oauth: ReturnType<typeof createOAuth> | undefined

export function useOAuth() {
  oauth ??= createOAuth({ db: useDb(), wrapper: useSourceWrapper() })
  return oauth
}
