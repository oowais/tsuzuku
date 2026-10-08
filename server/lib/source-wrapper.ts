import { and, eq } from 'drizzle-orm'
import { useDb, type Db } from '../db'
import { fetchCache, sourceAccounts, SOURCES, type Source, type SourceStatus } from '../db/schema'
import { USER_ID } from './user'

// The single place every Trakt, Simkl, MAL, TMDB and AniList call goes through (decision #8).
// Adapters hand in a fetcher returning a raw Response; the wrapper knows nothing about response shapes.

export interface SourceResult<T> {
  source: Source
  status: SourceStatus
  data: T | null
  // When `data` was fetched. For stale data this is the cache time.
  fetchedAt: Date | null
  // Seconds until the source may be called again; set only while rate limited.
  retryAfter: number | null
  // True when `data` came from the cache because the live call was blocked or failed.
  stale: boolean
  error?: string
}

export interface SourceCall<T> {
  source: Source
  fetcher: () => Promise<Response>
  // fetch_cache key. Set it for reads that may be served stale; leave it unset for writes.
  cacheKey?: string
  parse?: (res: Response) => Promise<T>
}

export interface BucketConfig {
  capacity: number
  refillPerSec: number
}

// Our own conservative throttle, not any documented limit. Tune per source once real limits are verified.
const DEFAULT_BUCKET: BucketConfig = { capacity: 5, refillPerSec: 1 }

// Used when a 429 has no usable Retry-After header. Our choice, not from any API docs.
const DEFAULT_RETRY_AFTER_SEC = 60

export class TokenBucket {
  private tokens: number
  private last: number

  constructor(private config: BucketConfig, private now: () => number) {
    this.tokens = config.capacity
    this.last = now()
  }

  // Takes a token and returns 0, or returns the milliseconds to wait for one.
  tryTake(): number {
    const t = this.now()
    this.tokens = Math.min(this.config.capacity, this.tokens + ((t - this.last) / 1000) * this.config.refillPerSec)
    this.last = t
    if (this.tokens >= 1) {
      this.tokens -= 1
      return 0
    }
    return Math.ceil(((1 - this.tokens) / this.config.refillPerSec) * 1000)
  }
}

// Retry-After is either delay-seconds or an HTTP date.
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.ceil((date - now) / 1000))
}

export interface WrapperOptions {
  db: Db
  userId?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  buckets?: Partial<Record<Source, BucketConfig>>
}

export function createSourceWrapper(opts: WrapperOptions) {
  const { db } = opts
  const userId = opts.userId ?? USER_ID
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const buckets = new Map<Source, TokenBucket>()

  const accountWhere = (source: Source) => and(eq(sourceAccounts.userId, userId), eq(sourceAccounts.source, source))

  function account(source: Source) {
    db.insert(sourceAccounts).values({ userId, source }).onConflictDoNothing().run()
    return db.select().from(sourceAccounts).where(accountWhere(source)).get()!
  }

  function setAccount(source: Source, values: Partial<typeof sourceAccounts.$inferInsert>) {
    db.update(sourceAccounts).set(values).where(accountWhere(source)).run()
  }

  async function throttle(source: Source) {
    let bucket = buckets.get(source)
    if (!bucket) {
      bucket = new TokenBucket(opts.buckets?.[source] ?? DEFAULT_BUCKET, now)
      buckets.set(source, bucket)
    }
    for (let wait = bucket.tryTake(); wait > 0; wait = bucket.tryTake()) await sleep(wait)
  }

  function readCache(source: Source, key: string | undefined) {
    if (key === undefined) return undefined
    return db.select().from(fetchCache)
      .where(and(eq(fetchCache.userId, userId), eq(fetchCache.source, source), eq(fetchCache.key, key)))
      .get()
  }

  function writeCache(source: Source, key: string, json: unknown, fetchedAt: Date) {
    db.insert(fetchCache).values({ userId, source, key, json, fetchedAt })
      .onConflictDoUpdate({ target: [fetchCache.userId, fetchCache.source, fetchCache.key], set: { json, fetchedAt } })
      .run()
  }

  // A failed or blocked call still returns the last good data, marked stale. No cache means data: null, never a fake value.
  function fallback<T>(call: SourceCall<T>, status: SourceStatus, extra: { retryAfter?: number, error?: string }): SourceResult<T> {
    const cached = readCache(call.source, call.cacheKey)
    return {
      source: call.source,
      status,
      data: cached ? (cached.json as T) : null,
      fetchedAt: cached?.fetchedAt ?? null,
      retryAfter: extra.retryAfter ?? null,
      stale: !!cached,
      error: extra.error
    }
  }

  async function call<T>(c: SourceCall<T>): Promise<SourceResult<T>> {
    const { source } = c
    const acct = account(source)

    if (acct.blockedUntil && acct.blockedUntil.getTime() > now()) {
      const retryAfter = Math.ceil((acct.blockedUntil.getTime() - now()) / 1000)
      return fallback(c, 'rate_limited', { retryAfter })
    }

    await throttle(source)

    let res: Response
    try {
      res = await c.fetcher()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setAccount(source, { lastStatus: 'error', lastError: error })
      return fallback(c, 'error', { error })
    }

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'), now()) ?? DEFAULT_RETRY_AFTER_SEC
      setAccount(source, { blockedUntil: new Date(now() + retryAfter * 1000), lastStatus: 'rate_limited', lastError: null })
      return fallback(c, 'rate_limited', { retryAfter })
    }

    if (res.status === 401) {
      const error = 'HTTP 401'
      setAccount(source, { lastStatus: 'auth_expired', lastError: error })
      return fallback(c, 'auth_expired', { error })
    }

    if (!res.ok) {
      const error = `HTTP ${res.status}`
      setAccount(source, { lastStatus: 'error', lastError: error })
      return fallback(c, 'error', { error })
    }

    let data: T
    try {
      data = c.parse ? await c.parse(res) : await res.json() as T
    } catch (err) {
      const error = `Unreadable response: ${err instanceof Error ? err.message : String(err)}`
      setAccount(source, { lastStatus: 'error', lastError: error })
      return fallback(c, 'error', { error })
    }

    const fetchedAt = new Date(now())
    if (c.cacheKey !== undefined) writeCache(source, c.cacheKey, data, fetchedAt)
    setAccount(source, { lastStatus: 'ok', lastError: null, lastFetchAt: fetchedAt, blockedUntil: null })
    return { source, status: 'ok', data, fetchedAt, retryAfter: null, stale: false }
  }

  // Runs calls side by side; one failing source never takes the others down.
  async function fetchAll<T>(calls: SourceCall<T>[]): Promise<SourceResult<T>[]> {
    const settled = await Promise.allSettled(calls.map(call))
    return settled.map((s, i) => s.status === 'fulfilled'
      ? s.value
      : { source: calls[i]!.source, status: 'error', data: null, fetchedAt: null, retryAfter: null, stale: false, error: String(s.reason) })
  }

  return { call, fetchAll }
}

export interface SourceStatusInfo {
  source: Source
  connected: boolean
  // null until the source has been called, or once a rate limit has run out and nothing has been called since.
  status: SourceStatus | null
  blockedUntil: Date | null
  retryAfter: number | null
  lastFetchAt: Date | null
  lastError: string | null
}

export function getSourceStatuses(db: Db, userId = USER_ID, now = Date.now()): SourceStatusInfo[] {
  const rows = db.select().from(sourceAccounts).where(eq(sourceAccounts.userId, userId)).all()
  return SOURCES.map((source) => {
    const row = rows.find(r => r.source === source)
    const blocked = !!row?.blockedUntil && row.blockedUntil.getTime() > now
    let status = row?.lastStatus ?? null
    if (blocked) status = 'rate_limited'
    else if (status === 'rate_limited') status = null
    return {
      source,
      connected: !!row?.accessTokenEnc,
      status,
      blockedUntil: blocked ? row!.blockedUntil : null,
      retryAfter: blocked ? Math.ceil((row!.blockedUntil!.getTime() - now) / 1000) : null,
      lastFetchAt: row?.lastFetchAt ?? null,
      lastError: row?.lastError ?? null
    }
  })
}

let wrapper: ReturnType<typeof createSourceWrapper> | undefined

export function useSourceWrapper() {
  wrapper ??= createSourceWrapper({ db: useDb() })
  return wrapper
}
