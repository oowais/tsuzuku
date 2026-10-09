import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db'
import { metadataCache, type SourceStatus } from '../db/schema'
import { USER_AGENT } from '../lib/oauth/providers'
import type { createSourceWrapper } from '../lib/source-wrapper'
import { USER_ID } from '../lib/user'

// AniList GraphQL, public, no auth: https://docs.anilist.co (checked 2026-10-08). Field names below were
// confirmed against the live schema. Rate limit: 90 per minute, currently 30 while the API is degraded,
// reported in X-RateLimit-Limit / -Remaining; a 429 carries Retry-After.
const API = 'https://graphql.anilist.co'
const BATCH = 50

// How long a cached entry is used before it is fetched again. Our choice: relations change when a
// sequel is announced, episode counts while a season airs. An entry whose next episode has aired since it
// was fetched is fetched again right away (#62).
export const ANILIST_TTL_MS = 7 * 24 * 60 * 60 * 1000

// `nextAiringEpisode` (seen 2026-10-09): { episode, airingAt } with airingAt in Unix seconds while airing,
// null once finished.
export function nextAiring(media: AniListMedia | null | undefined): { episode: number, airingAt: number } | null {
  const n = media?.nextAiringEpisode as { episode?: unknown, airingAt?: unknown } | null | undefined
  return n && typeof n.episode === 'number' && typeof n.airingAt === 'number' ? { episode: n.episode, airingAt: n.airingAt } : null
}

const QUERY = `query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: ${BATCH}) {
    pageInfo { hasNextPage }
    media(idMal_in: $ids, type: ANIME) {
      id idMal format episodes status season seasonYear synonyms
      nextAiringEpisode { episode airingAt }
      title { romaji english native }
      startDate { year month day }
      relations { edges { relationType node { id idMal type format episodes status title { romaji english } startDate { year } } } }
    }
  }
}`

// Raw AniList media, as returned. Only `idMal` is relied on here.
export interface AniListMedia {
  id: number
  idMal: number | null
  [key: string]: unknown
}

interface PageResponse {
  data?: { Page?: { pageInfo?: { hasNextPage?: boolean }, media?: AniListMedia[] } }
  errors?: { message?: string }[]
}

export interface AniListLookup {
  status: SourceStatus
  // Keyed by MAL ID. Null means AniList has no anime with that MAL ID.
  media: Record<number, AniListMedia | null>
  // MAL IDs that could not be looked up this time (source blocked or failing).
  missing: number[]
  retryAfter: number | null
  error?: string
}

export interface AniListOptions {
  db: Db
  wrapper: ReturnType<typeof createSourceWrapper>
  fetch?: typeof globalThis.fetch
  now?: () => number
  userId?: number
}

export function createAniListAdapter(opts: AniListOptions) {
  const { db, wrapper } = opts
  const doFetch = opts.fetch ?? globalThis.fetch
  const now = opts.now ?? Date.now
  const userId = opts.userId ?? USER_ID
  const cacheKey = (malId: number) => `mal:${malId}`

  function readCached(malIds: number[]) {
    if (!malIds.length) return []
    return db.select().from(metadataCache).where(and(
      eq(metadataCache.userId, userId),
      eq(metadataCache.provider, 'anilist'),
      inArray(metadataCache.externalId, malIds.map(cacheKey))
    )).all()
  }

  function saveCached(malId: number, media: AniListMedia | null) {
    const fetchedAt = new Date(now())
    // Wrapped so "no such anime" can be cached too; the column is not nullable.
    const json = { media }
    db.insert(metadataCache).values({ userId, provider: 'anilist', externalId: cacheKey(malId), json, fetchedAt })
      .onConflictDoUpdate({ target: [metadataCache.userId, metadataCache.provider, metadataCache.externalId], set: { json, fetchedAt } })
      .run()
  }

  // Looks up AniList entries by MAL ID, from the cache when fresh. A failed fetch still returns what the cache has.
  async function byMalIds(malIds: number[]): Promise<AniListLookup> {
    const unique = [...new Set(malIds)]
    const media: Record<number, AniListMedia | null> = {}
    const stale = new Map<number, AniListMedia | null>()

    for (const row of readCached(unique)) {
      const malId = Number(row.externalId.slice('mal:'.length))
      const value = (row.json as { media: AniListMedia | null }).media
      const age = now() - row.fetchedAt.getTime()
      const aired = nextAiring(value)
      // Fetched before its next episode aired, and that time has passed: the date is out of date.
      const passed = aired !== null && aired.airingAt * 1000 <= now() && row.fetchedAt.getTime() < aired.airingAt * 1000
      // Cached before the query asked for nextAiringEpisode (#62): fetch again once.
      const old = value !== null && !('nextAiringEpisode' in value)
      if (age < ANILIST_TTL_MS && !passed && !old) media[malId] = value
      else stale.set(malId, value)
    }

    let toFetch = unique.filter(id => !(id in media))
    for (let i = 0; i < toFetch.length; i += BATCH) {
      const ids = toFetch.slice(i, i + BATCH)
      const res = await wrapper.call<PageResponse>({
        source: 'anilist',
        fetcher: () => doFetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
          body: JSON.stringify({ query: QUERY, variables: { ids, page: 1 } })
        }),
        parse: async (r) => {
          const body = await r.json() as PageResponse
          if (body.errors?.length) throw new Error(body.errors.map(e => e.message).join('; '))
          return body
        }
      })

      if (res.status !== 'ok' || !res.data) {
        // Serve stale cache for whatever is left rather than nothing.
        toFetch = toFetch.slice(i)
        for (const id of toFetch) if (stale.has(id)) media[id] = stale.get(id)!
        return { status: res.status, media, missing: toFetch.filter(id => !(id in media)), retryAfter: res.retryAfter, error: res.error }
      }

      const page = res.data.data?.Page
      // 50 IDs at 50 per page fit in one page; more would mean the query returned something unexpected.
      if (page?.pageInfo?.hasNextPage) {
        return { status: 'error', media, missing: toFetch.slice(i).filter(id => !(id in media)), retryAfter: null, error: 'AniList returned more than one page for one batch' }
      }
      const found = new Map((page?.media ?? []).filter(m => typeof m.idMal === 'number').map(m => [m.idMal!, m]))
      for (const id of ids) {
        const value = found.get(id) ?? null
        media[id] = value
        saveCached(id, value)
      }
    }

    return { status: 'ok', media, missing: [], retryAfter: null }
  }

  return { byMalIds }
}
