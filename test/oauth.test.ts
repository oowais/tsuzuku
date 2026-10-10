import { createHash, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type Db } from '../server/db'
import { oauthStates, sourceAccounts } from '../server/db/schema'
import { decrypt, encrypt } from '../server/lib/crypto'
import { createOAuth, REFRESH_MARGIN_MS, STATE_TTL_MS } from '../server/lib/oauth'
import { createSourceWrapper } from '../server/lib/source-wrapper'

const key = randomBytes(32)
const env = {
  TOKEN_ENC_KEY: key.toString('base64'),
  APP_URL: 'http://localhost:3000',
  TRAKT_CLIENT_ID: 'trakt-id',
  SIMKL_CLIENT_ID: 'simkl-id',
  SIMKL_CLIENT_SECRET: 'simkl-secret',
  MAL_CLIENT_ID: 'mal-id',
  MAL_CLIENT_SECRET: 'mal-secret'
} as NodeJS.ProcessEnv

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init)

let db: Db
let t: number
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

function oauth() {
  const now = () => t
  const wrapper = createSourceWrapper({ db, now, sleep: async () => {} })
  return createOAuth({ db, wrapper, env, now, fetch: fetchMock })
}

function account(source: 'trakt' | 'simkl' | 'mal') {
  return db.select().from(sourceAccounts).all().find(a => a.source === source)
}

function seedAccount(source: 'trakt' | 'simkl' | 'mal', values: { access: string, refresh?: string, expiresAt?: Date | null }) {
  db.insert(sourceAccounts).values({
    userId: 1,
    source,
    accessTokenEnc: encrypt(values.access, key),
    refreshTokenEnc: values.refresh ? encrypt(values.refresh, key) : null,
    expiresAt: values.expiresAt ?? null,
    lastStatus: 'ok'
  }).run()
}

beforeEach(() => {
  db = createDb(':memory:')
  t = Date.UTC(2026, 9, 8, 12, 0, 0)
  fetchMock = vi.fn<typeof fetch>()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('start', () => {
  it('builds the Trakt authorize URL with state and an S256 PKCE challenge', () => {
    const { url, state } = oauth().start('trakt')
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://auth.trakt.tv/oauth/authorize')
    const { codeVerifier } = db.select().from(oauthStates).get()!
    expect(codeVerifier).toMatch(/^[\w-]{43,128}$/)
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'trakt-id',
      redirect_uri: 'http://localhost:3000/api/auth/trakt/callback',
      state,
      code_challenge: createHash('sha256').update(codeVerifier!).digest('base64url'),
      code_challenge_method: 'S256'
    })
    expect(state.length).toBeGreaterThanOrEqual(43)
  })

  it('needs no client secret for Trakt', () => {
    const o = createOAuth({ db, env: { ...env, TRAKT_CLIENT_ID: '' }, now: () => t, fetch: fetchMock })
    expect(() => o.start('trakt')).toThrow('TRAKT_CLIENT_ID must be set')
  })

  it('uses the Simkl AUTH V2 authorize URL with S256 PKCE and the write scope', () => {
    const u = new URL(oauth().start('simkl').url)
    expect(u.origin + u.pathname).toBe('https://simkl.com/oauth2/authorize')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('scope')).toBe('media:read media:write')
  })

  it('adds a plain PKCE challenge for MAL and stores the verifier', () => {
    const { url, state } = oauth().start('mal')
    const u = new URL(url)
    const challenge = u.searchParams.get('code_challenge')!
    expect(u.searchParams.get('code_challenge_method')).toBe('plain')
    expect(challenge).toMatch(/^[\w-]{43,128}$/)
    expect(db.select().from(oauthStates).get()).toMatchObject({ source: 'mal', state, codeVerifier: challenge })
  })

  it('fails clearly when credentials are missing', () => {
    const o = createOAuth({ db, env: { ...env, SIMKL_CLIENT_ID: '' }, now: () => t, fetch: fetchMock })
    expect(() => o.start('simkl')).toThrow('SIMKL_CLIENT_ID and SIMKL_CLIENT_SECRET must be set')
  })
})

describe('complete', () => {
  it('exchanges the Trakt code as JSON with the verifier and no secret, and stores encrypted tokens', async () => {
    const o = oauth()
    const { state } = o.start('trakt')
    const { codeVerifier } = db.select().from(oauthStates).get()!
    fetchMock.mockResolvedValueOnce(json({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 86400, token_type: 'bearer' }))

    await o.complete('trakt', { code: 'the-code', state }, state)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.trakt.tv/oauth/token')
    expect(init!.headers).toMatchObject({ 'Content-Type': 'application/json', 'trakt-api-key': 'trakt-id', 'trakt-api-version': '2' })
    expect(JSON.parse(init!.body as string)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://localhost:3000/api/auth/trakt/callback',
      code_verifier: codeVerifier,
      client_id: 'trakt-id'
    })

    const acct = account('trakt')!
    expect(acct.accessTokenEnc).not.toContain('acc-1')
    expect(decrypt(acct.accessTokenEnc!, key)).toBe('acc-1')
    expect(decrypt(acct.refreshTokenEnc!, key)).toBe('ref-1')
    expect(acct.expiresAt?.getTime()).toBe(t + 86400_000)
    expect(acct.lastStatus).toBe('ok')
  })

  it('sends the MAL exchange form encoded with the code verifier', async () => {
    const o = oauth()
    const { url, state } = o.start('mal')
    const verifier = new URL(url).searchParams.get('code_challenge')
    fetchMock.mockResolvedValueOnce(json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }))

    await o.complete('mal', { code: 'c', state }, state)

    const init = fetchMock.mock.calls[0]![1]!
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
    const body = new URLSearchParams(init.body as string)
    expect(body.get('code_verifier')).toBe(verifier)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_secret')).toBe('mal-secret')
  })

  it('exchanges the Simkl code at the V2 token URL with verifier and secret', async () => {
    const o = oauth()
    const { state } = o.start('simkl')
    const { codeVerifier } = db.select().from(oauthStates).get()!
    fetchMock.mockResolvedValueOnce(json({ access_token: 'simkl-acc', token_type: 'Bearer', expires_in: 604800, refresh_token: 'simkl-ref', scope: 'media:read media:write' }))

    await o.complete('simkl', { code: 'c', state }, state)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.simkl.com/oauth2/token')
    expect(JSON.parse(init!.body as string)).toEqual({
      grant_type: 'authorization_code',
      code: 'c',
      redirect_uri: 'http://localhost:3000/api/auth/simkl/callback',
      code_verifier: codeVerifier,
      client_id: 'simkl-id',
      client_secret: 'simkl-secret'
    })
    const acct = account('simkl')!
    expect(decrypt(acct.refreshTokenEnc!, key)).toBe('simkl-ref')
    expect(acct.expiresAt?.getTime()).toBe(t + 604800_000)
  })

  it('stores a token without expiry or refresh token when the response has neither', async () => {
    const o = oauth()
    const { state } = o.start('simkl')
    fetchMock.mockResolvedValueOnce(json({ access_token: 'simkl-acc' }))
    await o.complete('simkl', { code: 'c', state }, state)
    expect(account('simkl')).toMatchObject({ expiresAt: null, refreshTokenEnc: null })
  })

  it('rejects a state that does not match the cookie', async () => {
    const o = oauth()
    const { state } = o.start('trakt')
    await expect(o.complete('trakt', { code: 'c', state }, 'other')).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(o.complete('trakt', { code: 'c', state }, undefined)).rejects.toMatchObject({ code: 'invalid_state' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown, expired or reused state', async () => {
    const o = oauth()
    await expect(o.complete('trakt', { code: 'c', state: 'made-up' }, 'made-up')).rejects.toMatchObject({ code: 'invalid_state' })

    const expired = o.start('trakt').state
    t += STATE_TTL_MS + 1
    await expect(o.complete('trakt', { code: 'c', state: expired }, expired)).rejects.toMatchObject({ code: 'invalid_state' })

    const { state } = o.start('trakt')
    fetchMock.mockResolvedValueOnce(json({ access_token: 'a' }))
    await o.complete('trakt', { code: 'c', state }, state)
    await expect(o.complete('trakt', { code: 'c', state }, state)).rejects.toMatchObject({ code: 'invalid_state' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects a state issued for another source', async () => {
    const o = oauth()
    const { state } = o.start('trakt')
    await expect(o.complete('mal', { code: 'c', state }, state)).rejects.toMatchObject({ code: 'invalid_state' })
  })

  it('reports a denied authorization', async () => {
    await expect(oauth().complete('trakt', { error: 'access_denied' }, undefined)).rejects.toMatchObject({ code: 'denied' })
  })

  it('reports a failed exchange and stores nothing', async () => {
    const o = oauth()
    const { state } = o.start('trakt')
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, { status: 401 }))
    await expect(o.complete('trakt', { code: 'bad', state }, state)).rejects.toMatchObject({ code: 'exchange_failed' })
    expect(account('trakt')?.accessTokenEnc ?? null).toBeNull()
  })

  it('rejects a response without access_token', async () => {
    const o = oauth()
    const { state } = o.start('trakt')
    fetchMock.mockResolvedValueOnce(json({ token_type: 'bearer' }))
    await expect(o.complete('trakt', { code: 'c', state }, state)).rejects.toMatchObject({ code: 'exchange_failed' })
  })
})

describe('getAccessToken', () => {
  it('reports a source that was never connected', async () => {
    expect(await oauth().getAccessToken('trakt')).toEqual({ ok: false, reason: 'not_connected' })
  })

  it('returns the stored token without refreshing while it is fresh', async () => {
    seedAccount('trakt', { access: 'acc', refresh: 'ref', expiresAt: new Date(t + REFRESH_MARGIN_MS + 60_000) })
    expect(await oauth().getAccessToken('trakt')).toEqual({ ok: true, token: 'acc' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never refreshes a token without expiry', async () => {
    seedAccount('simkl', { access: 'simkl-acc' })
    expect(await oauth().getAccessToken('simkl')).toEqual({ ok: true, token: 'simkl-acc' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes near expiry and saves both new tokens', async () => {
    seedAccount('trakt', { access: 'old-acc', refresh: 'old-ref', expiresAt: new Date(t + 60_000) })
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new-acc', refresh_token: 'new-ref', expires_in: 86400 }))

    expect(await oauth().getAccessToken('trakt')).toEqual({ ok: true, token: 'new-acc' })

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body).toEqual({ grant_type: 'refresh_token', refresh_token: 'old-ref', redirect_uri: 'http://localhost:3000/api/auth/trakt/callback', client_id: 'trakt-id' })
    const acct = account('trakt')!
    expect(decrypt(acct.accessTokenEnc!, key)).toBe('new-acc')
    expect(decrypt(acct.refreshTokenEnc!, key)).toBe('new-ref')
    expect(acct.expiresAt?.getTime()).toBe(t + 86400_000)
  })

  it('logs each refresh with its expiry, or why it failed, never the tokens (#92)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      seedAccount('trakt', { access: 'old-acc', refresh: 'old-ref', expiresAt: new Date(t + 60_000) })
      fetchMock.mockResolvedValueOnce(json({ access_token: 'new-acc', refresh_token: 'new-ref', expires_in: 86400 }))
      await oauth().getAccessToken('trakt')
      expect(info).toHaveBeenCalledWith(`[oauth] trakt token refreshed, expires ${new Date(t + 86400_000).toISOString()}, new refresh token`)

      seedAccount('mal', { access: 'a', refresh: 'r', expiresAt: new Date(t) })
      fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, { status: 400 }))
      await oauth().getAccessToken('mal')
      expect(warn).toHaveBeenCalledWith('[oauth] mal refresh token rejected (HTTP 400 ({"error":"invalid_grant"})): reconnect mal')

      expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toMatch(/new-acc|new-ref|old-ref/)
    } finally {
      info.mockRestore()
      warn.mockRestore()
    }
  })

  it('keeps the old refresh token when the response has none', async () => {
    seedAccount('mal', { access: 'old-acc', refresh: 'old-ref', expiresAt: new Date(t) })
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new-acc', expires_in: 3600 }))
    await oauth().getAccessToken('mal')
    expect(decrypt(account('mal')!.refreshTokenEnc!, key)).toBe('old-ref')
  })

  it('shares one refresh between concurrent callers', async () => {
    seedAccount('mal', { access: 'old', refresh: 'ref', expiresAt: new Date(t) })
    let resolve!: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise(r => (resolve = r)))

    const o = oauth()
    const both = Promise.all([o.getAccessToken('mal'), o.getAccessToken('mal')])
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    resolve(json({ access_token: 'new', refresh_token: 'ref2', expires_in: 3600 }))

    expect(await both).toEqual([{ ok: true, token: 'new' }, { ok: true, token: 'new' }])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([400, 401])('marks auth_expired when the refresh token is rejected (%i)', async (status) => {
    seedAccount('mal', { access: 'old', refresh: 'ref', expiresAt: new Date(t) })
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, { status }))

    const o = oauth()
    expect(await o.getAccessToken('mal')).toMatchObject({ ok: false, reason: 'auth_expired' })
    expect(account('mal')!.lastStatus).toBe('auth_expired')

    // No retry storm: later calls report auth_expired without calling the source.
    expect(await o.getAccessToken('mal')).toMatchObject({ ok: false, reason: 'auth_expired' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps the tokens on a network error and does not mark auth_expired', async () => {
    seedAccount('trakt', { access: 'old', refresh: 'ref', expiresAt: new Date(t) })
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))

    expect(await oauth().getAccessToken('trakt')).toMatchObject({ ok: false, reason: 'error' })
    const acct = account('trakt')!
    expect(acct.lastStatus).toBe('error')
    expect(decrypt(acct.refreshTokenEnc!, key)).toBe('ref')
  })

  it('reports rate_limited when the token endpoint returns 429', async () => {
    seedAccount('trakt', { access: 'old', refresh: 'ref', expiresAt: new Date(t) })
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }))
    expect(await oauth().getAccessToken('trakt')).toEqual({ ok: false, reason: 'rate_limited', retryAfter: 30 })
  })
})
