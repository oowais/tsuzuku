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
  // HTTP status of the live call, when one was made and answered.
  httpStatus?: number
  error?: string
}

export interface SourceCall<T> {
  source: Source
  fetcher: () => Promise<Response>
  // fetch_cache key. Set it for reads that may be served stale; leave it unset for writes.
  cacheKey?: string
  parse?: (res: Response) => Promise<T>
  // A 404 is an answer ("no such show"), not a failure: data is null and the source status is untouched.
  notFoundOk?: boolean
  // A write: paced by its own bucket (WRITE_BUCKET) and never cached.
  write?: boolean
}

// Thrown inside `run` to abort a multi-request read; `run` turns it into a stale fallback.
export class SourceFailure extends Error {
  constructor(public status: Exclude<SourceStatus, 'ok'>, public extra: { retryAfter?: number, httpStatus?: number, error?: string } = {}) {
    super(extra.error ?? status)
  }
}

export interface RunContext<T> {
  // The last successful result for this cache key, if any.
  cached: T | undefined
  // One request through `call`, without its own cache entry. Throws SourceFailure unless it succeeds.
  request: <R>(fetcher: () => Promise<Response>) => Promise<{ data: R, headers: Headers }>
}

export interface BucketConfig {
  capacity: number
  refillPerSec: number
}

// Our own conservative throttle for sources without a documented limit.
const DEFAULT_BUCKET: BucketConfig = { capacity: 5, refillPerSec: 1 }

// Below the documented GET limits: Trakt 1000 per 5 minutes, Simkl 10 per second, AniList 30 per
// minute while degraded (90 normally). Trakt and Simkl also allow only 1 POST per second; writes
// use WRITE_BUCKET instead.
const SOURCE_BUCKETS: Partial<Record<Source, BucketConfig>> = {
  trakt: { capacity: 10, refillPerSec: 3 },
  simkl: { capacity: 5, refillPerSec: 5 },
  anilist: { capacity: 5, refillPerSec: 0.5 }
}

// Trakt and Simkl document 1 POST per second; MAL documents nothing, so it gets the same.
const WRITE_BUCKET: BucketConfig = { capacity: 1, refillPerSec: 1 }

// 204 No Content is an answer without data, not an unreadable one (Trakt `/users/{slug}/stats`, seen 2026-10-10).
async function readJson<T>(res: Response): Promise<T> {
  return (res.status === 204 ? null : await res.json()) as T
}

// Headers worth seeing while the real rate limit and paging behaviour is unverified. Values are not secret.
const LOGGED_HEADERS = /ratelimit|retry-after|pagination|x-request-id/i

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
  const buckets = new Map<string, TokenBucket>()

  const accountWhere = (source: Source) => and(eq(sourceAccounts.userId, userId), eq(sourceAccounts.source, source))

  function account(source: Source) {
    db.insert(sourceAccounts).values({ userId, source }).onConflictDoNothing().run()
    return db.select().from(sourceAccounts).where(accountWhere(source)).get()!
  }

  function setAccount(source: Source, values: Partial<typeof sourceAccounts.$inferInsert>) {
    db.update(sourceAccounts).set(values).where(accountWhere(source)).run()
  }

  async function throttle(source: Source, write = false) {
    const key = write ? `${source}:write` : source
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = new TokenBucket(write ? WRITE_BUCKET : opts.buckets?.[source] ?? SOURCE_BUCKETS[source] ?? DEFAULT_BUCKET, now)
      buckets.set(key, bucket)
    }
    for (let wait = bucket.tryTake(); wait > 0; wait = bucket.tryTake()) await sleep(wait)
  }

  const pathOf = (res: Response) => new URL(res.url || 'http://unknown').pathname

  // Every answer gets a line: status, path, and the headers worth seeing. Never request headers (tokens).
  function logResponse(source: Source, res: Response) {
    const seen = [...res.headers].filter(([name]) => LOGGED_HEADERS.test(name))
    console.info(`[${source}] ${res.status} ${pathOf(res)}${seen.length ? ` headers: ${seen.map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}`)
  }

  // Every failure gets a line too (#92): the database keeps only the last one, per source.
  function logFailure(source: Source, where: string, error: string) {
    console.warn(`[${source}] error ${where}: ${error}`)
  }

  // The start of a failed answer's body: says what refused (an API message, a proxy's error page). Read from a
  // clone so nothing else is affected; the body is the source's answer, never our request.
  async function bodyHint(res: Response): Promise<string> {
    try {
      const text = (await res.clone().text()).replace(/\s+/g, ' ').trim()
      return text ? ` (${text.slice(0, 200)}${text.length > 200 ? '…' : ''})` : ''
    } catch {
      return ''
    }
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
  function fallback<T>(call: Pick<SourceCall<T>, 'source' | 'cacheKey'>, status: SourceStatus, extra: { retryAfter?: number, httpStatus?: number, error?: string }): SourceResult<T> {
    const cached = readCache(call.source, call.cacheKey)
    return {
      source: call.source,
      status,
      data: cached ? (cached.json as T) : null,
      fetchedAt: cached?.fetchedAt ?? null,
      retryAfter: extra.retryAfter ?? null,
      stale: !!cached,
      httpStatus: extra.httpStatus,
      error: extra.error
    }
  }

  async function call<T>(c: SourceCall<T>): Promise<SourceResult<T>> {
    const { source } = c
    const acct = account(source)

    if (acct.blockedUntil && acct.blockedUntil.getTime() > now()) {
      const retryAfter = Math.ceil((acct.blockedUntil.getTime() - now()) / 1000)
      logFailure(source, '(not sent)', `rate limited, blocked for ${retryAfter} s more`)
      return fallback(c, 'rate_limited', { retryAfter })
    }

    await throttle(source, c.write)

    let res: Response
    try {
      res = await c.fetcher()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setAccount(source, { lastStatus: 'error', lastError: error })
      logFailure(source, '(no answer)', error)
      return fallback(c, 'error', { error })
    }

    logResponse(source, res)

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'), now()) ?? DEFAULT_RETRY_AFTER_SEC
      setAccount(source, { blockedUntil: new Date(now() + retryAfter * 1000), lastStatus: 'rate_limited', lastError: null })
      logFailure(source, pathOf(res), `HTTP 429, blocked for ${retryAfter} s`)
      return fallback(c, 'rate_limited', { retryAfter, httpStatus: 429 })
    }

    if (res.status === 401) {
      const error = 'HTTP 401'
      setAccount(source, { lastStatus: 'auth_expired', lastError: error })
      logFailure(source, pathOf(res), error)
      return fallback(c, 'auth_expired', { error, httpStatus: 401 })
    }

    if (res.status === 404 && c.notFoundOk) {
      return { source, status: 'ok', data: null, fetchedAt: new Date(now()), retryAfter: null, stale: false, httpStatus: 404 }
    }

    if (!res.ok) {
      const error = `HTTP ${res.status}${await bodyHint(res)}`
      setAccount(source, { lastStatus: 'error', lastError: error })
      logFailure(source, pathOf(res), error)
      return fallback(c, 'error', { error, httpStatus: res.status })
    }

    let data: T
    try {
      data = c.parse ? await c.parse(res) : await readJson<T>(res)
    } catch (err) {
      const error = `Unreadable response: ${err instanceof Error ? err.message : String(err)}`
      setAccount(source, { lastStatus: 'error', lastError: error })
      logFailure(source, pathOf(res), error)
      return fallback(c, 'error', { error, httpStatus: res.status })
    }

    const fetchedAt = new Date(now())
    if (c.cacheKey !== undefined && !c.write) writeCache(source, c.cacheKey, data, fetchedAt)
    setAccount(source, { lastStatus: 'ok', lastError: null, lastFetchAt: fetchedAt, blockedUntil: null })
    return { source, status: 'ok', data, fetchedAt, retryAfter: null, stale: false, httpStatus: res.status }
  }

  // A read that needs several requests (pages, Simkl's activities check and deltas). `fn` assembles the result;
  // it is cached under `cacheKey` only when every request succeeded, otherwise the last good result is served stale.
  async function run<T>(source: Source, cacheKey: string, fn: (ctx: RunContext<T>) => Promise<T>): Promise<SourceResult<T>> {
    const request = async <R>(fetcher: () => Promise<Response>) => {
      let headers = new Headers()
      const res = await call<R>({
        source,
        fetcher,
        parse: async (r) => {
          headers = r.headers
          return await readJson<R>(r)
        }
      })
      if (res.status !== 'ok') {
        throw new SourceFailure(res.status, { retryAfter: res.retryAfter ?? undefined, httpStatus: res.httpStatus, error: res.error })
      }
      return { data: res.data as R, headers }
    }

    try {
      const data = await fn({ cached: readCache(source, cacheKey)?.json as T | undefined, request })
      const fetchedAt = new Date(now())
      writeCache(source, cacheKey, data, fetchedAt)
      return { source, status: 'ok', data, fetchedAt, retryAfter: null, stale: false }
    } catch (err) {
      if (err instanceof SourceFailure) return fallback({ source, cacheKey }, err.status, err.extra)
      const error = err instanceof Error ? err.message : String(err)
      setAccount(source, { lastStatus: 'error', lastError: error })
      logFailure(source, cacheKey, error)
      return fallback({ source, cacheKey }, 'error', { error })
    }
  }

  // Runs calls side by side; one failing source never takes the others down.
  async function fetchAll<T>(calls: SourceCall<T>[]): Promise<SourceResult<T>[]> {
    const settled = await Promise.allSettled(calls.map(call))
    return settled.map((s, i) => s.status === 'fulfilled'
      ? s.value
      : { source: calls[i]!.source, status: 'error', data: null, fetchedAt: null, retryAfter: null, stale: false, error: String(s.reason) })
  }

  return {
    call,
    fetchAll,
    run,
    readCache: (source: Source, key: string) => readCache(source, key)?.json,
    // When the cached answer under `key` was fetched, or null when there is none.
    cachedAt: (source: Source, key: string) => readCache(source, key)?.fetchedAt ?? null,
    writeCache: (source: Source, key: string, json: unknown) => writeCache(source, key, json, new Date(now()))
  }
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
