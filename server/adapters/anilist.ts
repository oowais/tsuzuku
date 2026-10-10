import { createHash } from 'node:crypto'
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
// A batch's answer can spill past one page (two AniList entries on one MAL ID); more than this is not expected.
const MAX_BATCH_PAGES = 5

// How long a cached entry is used before it is fetched again. Our choice: relations change when a
// sequel is announced, episode counts while a season airs. An entry whose next episode has aired since it
// was fetched is fetched again right away (#62).
export const ANILIST_TTL_MS = 7 * 24 * 60 * 60 * 1000

// The relation edges' nodes carry `startDate` (year, month, day; day can be null) and `nextAiringEpisode` too,
// so a sequel's stage (announced, scheduled, airing) is known without looking the sequel up (#66, part 2), and
// `coverImage.medium` for the Coming back cards. Cached before either: fetched again once.
function relationNodesOld(value: AniListMedia): boolean {
  const edges = ((value.relations as { edges?: { node?: object }[] } | undefined)?.edges ?? [])
  return edges.some(e => !!e.node && (!('nextAiringEpisode' in e.node) || !('coverImage' in e.node)))
}

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
      relations { edges { relationType node { id idMal type format episodes status title { romaji english } startDate { year month day } nextAiringEpisode { episode airingAt } coverImage { medium } } } }
    }
  }
}`

// Title search for an anime nothing links yet (#66): AniList's own ranking, same fields as the lookup.
const SEARCH_QUERY = `query ($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id idMal format episodes status season seasonYear synonyms
      nextAiringEpisode { episode airingAt }
      title { romaji english native }
      startDate { year month day }
      relations { edges { relationType node { id idMal type format episodes status title { romaji english } startDate { year month day } nextAiringEpisode { episode airingAt } coverImage { medium } } } }
    }
  }
}`

const SCHEDULE_QUERY = `query ($ids: [Int], $from: Int, $to: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { mediaId episode airingAt }
  }
}`
// A month of weekly episodes for 50 anime is about 250 entries, 5 pages.
const MAX_SCHEDULE_PAGES = 20
export const SCHEDULE_TTL_MS = 6 * 60 * 60 * 1000

export interface AiringEpisode {
  mediaId: number
  episode: number
  // Unix seconds.
  airingAt: number
}

interface ScheduleResponse {
  data?: { Page?: { pageInfo?: { hasNextPage?: boolean }, airingSchedules?: Partial<AiringEpisode>[] } }
  errors?: { message?: string }[]
}

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
  // `ttlFor` gives an entry's own freshness (Coming back keeps entries by sequel stage); the default is one for all.
  async function byMalIds(malIds: number[], ttlFor: (media: AniListMedia | null) => number = () => ANILIST_TTL_MS): Promise<AniListLookup> {
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
      const old = value !== null && (!('nextAiringEpisode' in value) || relationNodesOld(value))
      if (age < ttlFor(value) && !passed && !old) media[malId] = value
      else stale.set(malId, value)
    }

    const toFetch = unique.filter(id => !(id in media))
    // A failed batch is skipped and the rest still asked (#92); a rate limit stops the lookup, since the wrapper
    // blocks AniList until it lifts. Either way stale rows stand in for what could not be fetched.
    let failure: { status: SourceStatus, retryAfter: number | null, error?: string } | null = null
    const standIn = (ids: number[]) => {
      for (const id of ids) if (stale.has(id)) media[id] = stale.get(id)!
    }
    // One request per page of a batch. Seen 2026-10-10: a batch of 50 MAL IDs can answer more than 50 media
    // (some MAL IDs are on more than one AniList entry), so the answer spills onto a second page.
    const fetchPage = (ids: number[], page: number) => wrapper.call<PageResponse>({
      source: 'anilist',
      fetcher: () => doFetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query: QUERY, variables: { ids, page } })
      }),
      parse: async (r) => {
        const body = await r.json() as PageResponse
        if (body.errors?.length) throw new Error(body.errors.map(e => e.message).join('; '))
        return body
      }
    })

    batches: for (let i = 0; i < toFetch.length; i += BATCH) {
      const ids = toFetch.slice(i, i + BATCH)
      const items: AniListMedia[] = []
      for (let page = 1; ; page++) {
        if (page > MAX_BATCH_PAGES) {
          failure = { status: 'error', retryAfter: null, error: `AniList answered more than ${MAX_BATCH_PAGES} pages for one batch` }
          console.warn(`[anilist] error: ${failure.error}`)
          standIn(ids)
          continue batches
        }
        const res = await fetchPage(ids, page)
        if (res.status !== 'ok' || !res.data) {
          failure = { status: res.status, retryAfter: res.retryAfter, error: res.error }
          if (res.status === 'rate_limited') {
            standIn(toFetch.slice(i))
            break batches
          }
          standIn(ids)
          continue batches
        }
        const answer = res.data.data?.Page
        items.push(...(answer?.media ?? []))
        if (!answer?.pageInfo?.hasNextPage) break
      }

      // A MAL ID on more than one AniList entry keeps the first one AniList listed.
      const found = new Map<number, AniListMedia>()
      for (const m of items) if (typeof m.idMal === 'number' && !found.has(m.idMal)) found.set(m.idMal, m)
      for (const id of ids) {
        const value = found.get(id) ?? null
        media[id] = value
        saveCached(id, value)
      }
    }

    if (failure) return { ...failure, media, missing: toFetch.filter(id => !(id in media)) }
    return { status: 'ok', media, missing: [], retryAfter: null }
  }

  // What the cache has, however old, without calling AniList: for hints that must not cost a request (#78).
  function cachedByMalIds(malIds: number[]): Record<number, AniListMedia | null> {
    const media: Record<number, AniListMedia | null> = {}
    for (const row of readCached([...new Set(malIds)])) media[Number(row.externalId.slice('mal:'.length))] = (row.json as { media: AniListMedia | null }).media
    return media
  }

  // Anime matching a title, best first; only entries with a MAL ID (the ID every write here uses). Each
  // result is cached like a lookup, so the preview that follows reads it without asking again.
  async function search(text: string): Promise<{ status: SourceStatus, media: AniListMedia[], retryAfter: number | null, error?: string }> {
    const res = await wrapper.call<PageResponse>({
      source: 'anilist',
      fetcher: () => doFetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query: SEARCH_QUERY, variables: { search: text } })
      }),
      parse: async (r) => {
        const body = await r.json() as PageResponse
        if (body.errors?.length) throw new Error(body.errors.map(e => e.message).join('; '))
        return body
      }
    })
    if (res.status !== 'ok' || !res.data) return { status: res.status, media: [], retryAfter: res.retryAfter, error: res.error }
    const media = (res.data.data?.Page?.media ?? []).filter(m => typeof m.idMal === 'number')
    for (const m of media) saveCached(m.idMal!, m)
    return { status: 'ok', media, retryAfter: null }
  }

  // Episodes airing between two times (Unix seconds) for AniList media IDs (#72), as `{ mediaId, episode,
  // airingAt }`, oldest first. Seen 2026-10-10: `Page.airingSchedules(mediaId_in, airingAt_greater,
  // airingAt_lesser, sort: TIME)` lists past and future episodes in the range, 50 per page. Cached a few hours.
  async function airingSchedule(anilistIds: number[], from: number, to: number) {
    const ids = [...new Set(anilistIds)].sort((a, b) => a - b)
    const key = `schedule:${from}:${to}:${createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12)}`
    const cachedAt = wrapper.cachedAt('anilist', key)
    if (!ids.length) return { source: 'anilist' as const, status: 'ok' as const, data: [] as AiringEpisode[], fetchedAt: null, retryAfter: null, stale: false }
    if (cachedAt && now() - cachedAt.getTime() < SCHEDULE_TTL_MS) {
      return { source: 'anilist' as const, status: 'ok' as const, data: wrapper.readCache('anilist', key) as AiringEpisode[], fetchedAt: cachedAt, retryAfter: null, stale: false }
    }
    return wrapper.run<AiringEpisode[]>('anilist', key, async ({ request }) => {
      const out: AiringEpisode[] = []
      for (let i = 0; i < ids.length; i += BATCH) {
        for (let page = 1; ; page++) {
          if (page > MAX_SCHEDULE_PAGES) throw new Error(`AniList airing schedule has more than ${MAX_SCHEDULE_PAGES} pages`)
          const { data } = await request<ScheduleResponse>(() => doFetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({ query: SCHEDULE_QUERY, variables: { ids: ids.slice(i, i + BATCH), from, to, page } })
          }))
          if (data?.errors?.length) throw new Error(data.errors.map(e => e.message).join('; '))
          const answer = data?.data?.Page
          for (const a of answer?.airingSchedules ?? []) {
            if (typeof a.mediaId === 'number' && typeof a.episode === 'number' && typeof a.airingAt === 'number') out.push({ mediaId: a.mediaId, episode: a.episode, airingAt: a.airingAt })
          }
          if (!answer?.pageInfo?.hasNextPage) break
        }
      }
      return out.sort((a, b) => a.airingAt - b.airingAt)
    })
  }

  return { byMalIds, cachedByMalIds, search, airingSchedule }
}
