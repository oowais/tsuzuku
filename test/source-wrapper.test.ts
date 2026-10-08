import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type Db } from '../server/db'
import { sourceAccounts } from '../server/db/schema'
import { createSourceWrapper, getSourceStatuses, parseRetryAfter, TokenBucket } from '../server/lib/source-wrapper'

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init)

let db: Db
let t: number
const now = () => t
const sleep = vi.fn(async (ms: number) => {
  t += ms
})

function wrapper() {
  return createSourceWrapper({ db, now, sleep, buckets: { trakt: { capacity: 100, refillPerSec: 100 } } })
}

beforeEach(() => {
  db = createDb(':memory:')
  t = Date.UTC(2026, 9, 8, 12, 0, 0)
  sleep.mockClear()
})

describe('source wrapper', () => {
  it('returns fresh data and caches it', async () => {
    const w = wrapper()
    const res = await w.call({ source: 'trakt', cacheKey: 'list', fetcher: async () => json({ a: 1 }) })
    expect(res).toMatchObject({ status: 'ok', data: { a: 1 }, stale: false, retryAfter: null })
    expect(res.fetchedAt?.getTime()).toBe(t)
  })

  it('on 429 saves blocked_until, stops calling, and serves the cache as stale', async () => {
    const w = wrapper()
    const cachedAt = t
    await w.call({ source: 'trakt', cacheKey: 'list', fetcher: async () => json({ a: 1 }) })

    t += 5_000
    const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '42' } }))
    const limited = await w.call({ source: 'trakt', cacheKey: 'list', fetcher })
    expect(limited).toMatchObject({ status: 'rate_limited', retryAfter: 42, stale: true, data: { a: 1 } })
    expect(limited.fetchedAt?.getTime()).toBe(cachedAt)

    const row = db.select().from(sourceAccounts).get()!
    expect(row.blockedUntil?.getTime()).toBe(t + 42_000)
    expect(row.lastStatus).toBe('rate_limited')

    t += 10_000
    const blocked = await w.call({ source: 'trakt', cacheKey: 'list', fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(blocked).toMatchObject({ status: 'rate_limited', retryAfter: 32, stale: true, data: { a: 1 } })

    t += 33_000
    const recovered = await w.call({ source: 'trakt', cacheKey: 'list', fetcher: async () => json({ a: 2 }) })
    expect(recovered).toMatchObject({ status: 'ok', data: { a: 2 }, stale: false })
    expect(db.select().from(sourceAccounts).get()!.blockedUntil).toBeNull()
  })

  it('blocks only the source that was rate limited', async () => {
    const w = wrapper()
    await w.call({ source: 'trakt', fetcher: async () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } }) })
    const other = vi.fn(async () => json({ ok: true }))
    expect(await w.call({ source: 'simkl', fetcher: other })).toMatchObject({ status: 'ok' })
    expect(other).toHaveBeenCalledOnce()
  })

  it('uses a 60 s default when a 429 has no Retry-After', async () => {
    const res = await wrapper().call({ source: 'trakt', fetcher: async () => new Response(null, { status: 429 }) })
    expect(res.retryAfter).toBe(60)
  })

  it('serves stale cache on a server error and on a network failure', async () => {
    const w = wrapper()
    const cachedAt = t
    await w.call({ source: 'mal', cacheKey: 'watching', fetcher: async () => json([1, 2]) })

    t += 60_000
    const http = await w.call({ source: 'mal', cacheKey: 'watching', fetcher: async () => new Response('boom', { status: 503 }) })
    expect(http).toMatchObject({ status: 'error', stale: true, data: [1, 2], error: 'HTTP 503' })
    expect(http.fetchedAt?.getTime()).toBe(cachedAt)

    const network = await w.call({ source: 'mal', cacheKey: 'watching', fetcher: () => Promise.reject(new Error('ECONNRESET')) })
    expect(network).toMatchObject({ status: 'error', stale: true, data: [1, 2], error: 'ECONNRESET' })
  })

  it('returns data: null, not stale, when there is no cache', async () => {
    const res = await wrapper().call({ source: 'mal', cacheKey: 'watching', fetcher: async () => new Response(null, { status: 500 }) })
    expect(res).toMatchObject({ status: 'error', data: null, stale: false, fetchedAt: null })
  })

  it('maps 401 to auth_expired', async () => {
    const res = await wrapper().call({ source: 'simkl', fetcher: async () => new Response(null, { status: 401 }) })
    expect(res.status).toBe('auth_expired')
  })

  it('does not cache calls without a cache key', async () => {
    const w = wrapper()
    await w.call({ source: 'trakt', fetcher: async () => json({ written: true }) })
    const res = await w.call({ source: 'trakt', fetcher: async () => new Response(null, { status: 500 }) })
    expect(res).toMatchObject({ data: null, stale: false })
  })

  it('throttles with the per-source token bucket', async () => {
    const w = createSourceWrapper({ db, now, sleep, buckets: { tmdb: { capacity: 2, refillPerSec: 1 } } })
    const fetcher = async () => json({})
    await w.call({ source: 'tmdb', fetcher })
    await w.call({ source: 'tmdb', fetcher })
    expect(sleep).not.toHaveBeenCalled()
    await w.call({ source: 'tmdb', fetcher })
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('fetchAll keeps the other sources when one fails', async () => {
    const results = await wrapper().fetchAll([
      { source: 'trakt', fetcher: async () => json({ s: 'trakt' }) },
      { source: 'simkl', fetcher: () => Promise.reject(new Error('down')) },
      { source: 'mal', fetcher: async () => json({ s: 'mal' }) }
    ])
    expect(results.map(r => r.status)).toEqual(['ok', 'error', 'ok'])
    expect(results[2]!.data).toEqual({ s: 'mal' })
  })
})

describe('getSourceStatuses', () => {
  it('reports every source, with a countdown while blocked', async () => {
    await wrapper().call({ source: 'trakt', fetcher: async () => new Response(null, { status: 429, headers: { 'Retry-After': '42' } }) })
    t += 2_000
    const statuses = getSourceStatuses(db, 1, t)
    expect(statuses.map(s => s.source)).toEqual(['trakt', 'simkl', 'mal', 'tmdb', 'anilist'])
    expect(statuses[0]).toMatchObject({ status: 'rate_limited', retryAfter: 40, connected: false })
    expect(statuses[1]).toMatchObject({ status: null, retryAfter: null })

    expect(getSourceStatuses(db, 1, t + 41_000)[0]).toMatchObject({ status: null, retryAfter: null, blockedUntil: null })
  })
})

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    const t0 = Date.UTC(2026, 9, 8, 12, 0, 0)
    expect(parseRetryAfter('42', t0)).toBe(42)
    expect(parseRetryAfter(new Date(t0 + 90_000).toUTCString(), t0)).toBe(90)
    expect(parseRetryAfter('soon', t0)).toBeNull()
    expect(parseRetryAfter(null, t0)).toBeNull()
  })
})

describe('TokenBucket', () => {
  it('refills over time', () => {
    let clock = 0
    const b = new TokenBucket({ capacity: 1, refillPerSec: 2 }, () => clock)
    expect(b.tryTake()).toBe(0)
    expect(b.tryTake()).toBe(500)
    clock += 500
    expect(b.tryTake()).toBe(0)
  })
})
