import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANILIST_TTL_MS, createAniListAdapter } from '../server/adapters/anilist'
import { createMalAdapter } from '../server/adapters/mal'
import { createSimklAdapter, mergeDelta, type SimklItem } from '../server/adapters/simkl'
import { CALENDAR_TTL_MS, createTraktAdapter, PAGE_LIMIT } from '../server/adapters/trakt'
import { createTraktPublic, slugFromTraktUrl } from '../server/adapters/trakt-public'
import { createDb, type Db } from '../server/db'
import { sourceAccounts } from '../server/db/schema'
import type { AccessTokenResult } from '../server/lib/oauth'
import { createSourceWrapper } from '../server/lib/source-wrapper'

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init)
const env = { TRAKT_CLIENT_ID: 'trakt-id', SIMKL_CLIENT_ID: 'simkl-id', SIMKL_CLIENT_SECRET: 'simkl-secret' } as NodeJS.ProcessEnv

let db: Db
let t: number
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
let token: AccessTokenResult

function opts() {
  const wrapper = createSourceWrapper({ db, now: () => t, sleep: async (ms) => {
    t += ms
  } })
  return { wrapper, oauth: { getAccessToken: async () => token }, env, fetch: fetchMock }
}

// Request paths in call order, without the query string.
const paths = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)
const query = (i: number) => Object.fromEntries(new URL(String(fetchMock.mock.calls[i]![0])).searchParams)

const item = (id: number, status = 'watching'): SimklItem => ({ status, show: { ids: { simkl: id } } })

function activities(all: string, overrides: { shows?: Record<string, string>, anime?: Record<string, string> } = {}) {
  const block = { all, watching: 'w0', plantowatch: 'p0', hold: 'h0', completed: 'c0', dropped: 'd0', removed_from_list: 'r0', rated_at: 'x0' }
  return { all, tv_shows: { ...block, ...overrides.shows }, anime: { ...block, ...overrides.anime } }
}

beforeEach(() => {
  db = createDb(':memory:')
  t = Date.UTC(2026, 9, 8, 12, 0, 0)
  fetchMock = vi.fn<typeof fetch>()
  token = { ok: true, token: 'acc' }
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('simkl watching', () => {
  async function firstRun() {
    fetchMock
      .mockResolvedValueOnce(json(activities('2026-10-01T00:00:00Z')))
      .mockResolvedValueOnce(json({ shows: [item(1), item(2)] }))
      .mockResolvedValueOnce(json({ anime: [item(10)] }))
    const res = await createSimklAdapter(opts()).fetchWatching()
    fetchMock.mockClear()
    return res
  }

  it('caches the first pull and sends the app params and token on every request', async () => {
    const res = await firstRun()
    expect(res).toMatchObject({ status: 'ok', stale: false, data: { shows: [item(1), item(2)], anime: [item(10)] } })

    fetchMock
      .mockResolvedValueOnce(json(activities('2026-10-01T00:00:00Z')))
    await createSimklAdapter(opts()).fetchWatching()
    expect(paths()).toEqual(['/sync/activities'])
    expect(query(0)).toEqual({ 'client_id': 'simkl-id', 'app-name': 'tsuzuku', 'app-version': '0.1' })
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({ 'Authorization': 'Bearer acc', 'User-Agent': 'Tsuzuku/0.1' })
  })

  it('calls the first-run endpoints in order', async () => {
    fetchMock
      .mockResolvedValueOnce(json(activities('a')))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({}))
    const res = await createSimklAdapter(opts()).fetchWatching()
    expect(paths()).toEqual(['/sync/activities', '/sync/all-items/shows/watching', '/sync/all-items/anime/watching'])
    expect(query(1)).toMatchObject({ next_watch_info: 'yes' })
    expect(res.data).toEqual({ shows: [], anime: [] })
  })

  it('serves the cached list when activities have not moved', async () => {
    await firstRun()
    t += 60_000
    fetchMock.mockResolvedValueOnce(json(activities('2026-10-01T00:00:00Z')))

    const res = await createSimklAdapter(opts()).fetchWatching()

    expect(paths()).toEqual(['/sync/activities'])
    expect(res).toMatchObject({ status: 'ok', stale: false, data: { shows: [item(1), item(2)], anime: [item(10)] } })
    expect(res.fetchedAt?.getTime()).toBe(t)
  })

  it('fetches only the moved type since the saved snapshot and merges it', async () => {
    await firstRun()
    fetchMock
      .mockResolvedValueOnce(json(activities('2026-10-02T00:00:00Z', { shows: { watching: 'w1', completed: 'c1' } })))
      .mockResolvedValueOnce(json({ shows: [item(2, 'completed'), item(3)] }))

    const res = await createSimklAdapter(opts()).fetchWatching()

    expect(paths()).toEqual(['/sync/activities', '/sync/all-items/shows'])
    expect(query(1)).toMatchObject({ date_from: '2026-10-01T00:00:00Z' })
    expect(res.data).toEqual({ shows: [item(1), item(3)], anime: [item(10)] })
  })

  it('finds removals with an ID-only fetch when removed_from_list moved', async () => {
    await firstRun()
    fetchMock
      .mockResolvedValueOnce(json(activities('2026-10-02T00:00:00Z', { anime: { removed_from_list: 'r1' } })))
      .mockResolvedValueOnce(json({}))

    const res = await createSimklAdapter(opts()).fetchWatching()

    expect(paths()).toEqual(['/sync/activities', '/sync/all-items/anime/watching'])
    expect(query(1)).toMatchObject({ extended: 'simkl_ids_only' })
    expect(res.data).toEqual({ shows: [item(1), item(2)], anime: [] })
  })

  it('keeps the old snapshot when a delta fails, so the next run asks for the same range', async () => {
    await firstRun()
    fetchMock
      .mockResolvedValueOnce(json(activities('2026-10-02T00:00:00Z', { shows: { watching: 'w1' } })))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))

    const failed = await createSimklAdapter(opts()).fetchWatching()
    expect(failed).toMatchObject({ status: 'error', stale: true, data: { shows: [item(1), item(2)], anime: [item(10)] } })

    fetchMock.mockClear()
    fetchMock
      .mockResolvedValueOnce(json(activities('2026-10-03T00:00:00Z', { shows: { watching: 'w2' } })))
      .mockResolvedValueOnce(json({ shows: [item(4)] }))
    await createSimklAdapter(opts()).fetchWatching()
    expect(query(1)).toMatchObject({ date_from: '2026-10-01T00:00:00Z' })
  })

  it('fails without saving anything when an item has no simkl id', async () => {
    fetchMock
      .mockResolvedValueOnce(json(activities('a')))
      .mockResolvedValueOnce(json({ shows: [{ status: 'watching', show: { ids: {} } }] }))
    const res = await createSimklAdapter(opts()).fetchWatching()
    expect(res).toMatchObject({ status: 'error', data: null, error: 'Simkl item without show.ids.simkl' })
  })

  it('reports a missing connection without calling Simkl', async () => {
    token = { ok: false, reason: 'not_connected' }
    const res = await createSimklAdapter(opts()).fetchWatching()
    expect(res).toMatchObject({ status: 'error', error: 'Not connected', data: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes a 429 through as rate limited and blocks the source', async () => {
    await firstRun()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }))
    const res = await createSimklAdapter(opts()).fetchWatching()
    expect(res).toMatchObject({ status: 'rate_limited', retryAfter: 30, stale: true })
    expect(db.select().from(sourceAccounts).get()?.blockedUntil?.getTime()).toBe(t + 30_000)
  })
})

describe('mergeDelta', () => {
  it('updates, adds and drops items by simkl id', () => {
    const updated = { ...item(1), watched_episodes_count: 5 }
    expect(mergeDelta([item(1), item(2)], [updated, item(2, 'hold'), item(3)])).toEqual([updated, item(3)])
  })
})

describe('mal watching', () => {
  const page = (ids: number[], next?: string) => json({ data: ids.map(id => ({ node: { id } })), paging: next ? { next } : {} })

  it('requests the watching list with fields and follows paging.next', async () => {
    fetchMock
      .mockResolvedValueOnce(page([1, 2], 'https://api.myanimelist.net/v2/users/@me/animelist?offset=2'))
      .mockResolvedValueOnce(page([3]))

    const res = await createMalAdapter(opts()).fetchWatching()

    expect(res).toMatchObject({ status: 'ok', data: { data: [{ node: { id: 1 } }, { node: { id: 2 } }, { node: { id: 3 } }] } })
    expect(query(0)).toMatchObject({ status: 'watching', limit: '1000', nsfw: 'true' })
    expect(query(0).fields).toContain('list_status')
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.myanimelist.net/v2/users/@me/animelist?offset=2')
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: 'Bearer acc' })
  })

  it('never follows a next link to another host', async () => {
    fetchMock.mockResolvedValueOnce(page([1], 'https://evil.example/steal'))
    const res = await createMalAdapter(opts()).fetchWatching()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data).toEqual({ data: [{ node: { id: 1 } }] })
  })

  it('serves the last good list, marked stale, when a later page fails', async () => {
    fetchMock.mockResolvedValueOnce(page([1]))
    await createMalAdapter(opts()).fetchWatching()

    fetchMock
      .mockResolvedValueOnce(page([1], 'https://api.myanimelist.net/v2/users/@me/animelist?offset=1'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const res = await createMalAdapter(opts()).fetchWatching()
    expect(res).toMatchObject({ status: 'error', stale: true, data: { data: [{ node: { id: 1 } }] } })
  })
})

describe('trakt up_next', () => {
  const shows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ show: { ids: { trakt: from + i } } }))

  it('requests full extended data newest-watched first, with the Trakt headers', async () => {
    fetchMock.mockResolvedValueOnce(json(shows(1, 3)))

    const res = await createTraktAdapter(opts()).fetchUpNext()

    expect(res).toMatchObject({ status: 'ok', data: shows(1, 3) })
    expect(paths()).toEqual(['/sync/progress/up_next'])
    expect(query(0)).toEqual({ extended: 'full', page: '1', limit: String(PAGE_LIMIT), sort_how: 'desc' })
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({
      'Authorization': 'Bearer acc',
      'trakt-api-key': 'trakt-id',
      'trakt-api-version': '2'
    })
  })

  it('stops on a short page even when the page count says there are more (as Trakt really sends)', async () => {
    fetchMock.mockResolvedValueOnce(json(shows(1, 9), { headers: { 'X-Pagination-Page-Count': '14', 'X-Pagination-Item-Count': '1337' } }))

    const res = await createTraktAdapter(opts()).fetchUpNext()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data).toEqual(shows(1, 9))
  })

  it('fetches the next page after a full one, until a page comes back short', async () => {
    fetchMock
      .mockResolvedValueOnce(json(shows(1, PAGE_LIMIT)))
      .mockResolvedValueOnce(json(shows(1000, 2)))

    const res = await createTraktAdapter(opts()).fetchUpNext()

    expect(query(1)).toMatchObject({ page: '2' })
    expect(res.data).toHaveLength(PAGE_LIMIT + 2)
  })

  it('stops at the last page by count even when it is full', async () => {
    fetchMock.mockResolvedValueOnce(json(shows(1, PAGE_LIMIT), { headers: { 'X-Pagination-Page-Count': '1' } }))
    await createTraktAdapter(opts()).fetchUpNext()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a non-list response as an error and keeps the cache', async () => {
    fetchMock.mockResolvedValueOnce(json(shows(1, 1)))
    await createTraktAdapter(opts()).fetchUpNext()
    fetchMock.mockResolvedValueOnce(json({ error: 'nope' }))

    const res = await createTraktAdapter(opts()).fetchUpNext()

    expect(res).toMatchObject({ status: 'error', stale: true, data: shows(1, 1), error: 'Trakt up_next did not return a list' })
  })
})

describe('calendar reads (#72)', () => {
  it('asks Trakt for your calendar with the token, at most 33 days, and reuses it for a few hours', async () => {
    fetchMock.mockResolvedValue(json([{ first_aired: '2026-10-10T00:00:00.000Z' }]))
    const trakt = createTraktAdapter({ ...opts(), now: () => t })
    expect((await trakt.calendar('2026-10-01', 40)).data).toHaveLength(1)
    expect(paths()).toEqual(['/calendars/my/shows/2026-10-01/33'])
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: 'Bearer acc' })
    await trakt.calendar('2026-10-01', 40)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    t += CALENDAR_TTL_MS
    await trakt.calendar('2026-10-01', 40)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads your Trakt history by slug, paged, and again after a Trakt write', async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(String(url))
      if (u.pathname === '/users/settings') return json({ user: { ids: { slug: 'me' } } })
      const page = Number(u.searchParams.get('page'))
      return json([{ episode: { season: 1, number: page }, show: { ids: { trakt: 7 } } }], { headers: { 'x-pagination-page-count': '2' } })
    })
    const trakt = createTraktAdapter({ ...opts(), now: () => t })
    const from = new Date(t - 10 * 24 * 60 * 60 * 1000)
    const res = await trakt.watchedBetween(from, new Date(t), null)
    expect(res.data).toEqual([{ show: 7, season: 1, number: 1 }, { show: 7, season: 1, number: 2 }])
    expect(paths()).toEqual(['/users/settings', '/users/me/history/episodes', '/users/me/history/episodes'])
    expect(query(1)).toMatchObject({ start_at: from.toISOString(), end_at: new Date(t).toISOString(), limit: '250' })
    await trakt.watchedBetween(from, new Date(t), new Date(t - 1000))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await trakt.watchedBetween(from, new Date(t), new Date(t + 1000))
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('follows AniList airing schedule pages and asks nothing without anime', async () => {
    const page = (hasNextPage: boolean, list: unknown[]) => json({ data: { Page: { pageInfo: { hasNextPage }, airingSchedules: list } } })
    fetchMock.mockResolvedValueOnce(page(true, [{ mediaId: 1, episode: 2, airingAt: 200 }])).mockResolvedValueOnce(page(false, [{ mediaId: 1, episode: 1, airingAt: 100 }]))
    const anilist = createAniListAdapter({ db, wrapper: opts().wrapper, fetch: fetchMock, now: () => t })
    const res = await anilist.airingSchedule([1], 0, 1000)
    expect(res.data).toEqual([{ mediaId: 1, episode: 1, airingAt: 100 }, { mediaId: 1, episode: 2, airingAt: 200 }])
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body)).variables).toMatchObject({ ids: [1], from: 0, to: 1000, page: 2 })
    expect((await anilist.airingSchedule([], 0, 1000)).data).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('anilist by MAL ID', () => {
  // As the current query answers: nextAiringEpisode is always present, null once finished.
  const media = (idMal: number) => ({ id: idMal + 1000, idMal, nextAiringEpisode: null, relations: { edges: [] } })
  const page = (items: unknown[], hasNextPage = false) => json({ data: { Page: { pageInfo: { hasNextPage }, media: items } } })
  const anilist = () => createAniListAdapter({ db, wrapper: opts().wrapper, fetch: fetchMock, now: () => t })

  it('fetches unknown IDs in one batch and caches hits and misses', async () => {
    fetchMock.mockResolvedValueOnce(page([media(1)]))

    const res = await anilist().byMalIds([1, 2, 1])

    expect(res).toMatchObject({ status: 'ok', media: { 1: media(1), 2: null }, missing: [] })
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body.variables).toEqual({ ids: [1, 2], page: 1 })
    expect(body.query).toContain('idMal_in: $ids')
    expect(body.query).toContain('startDate { year month day } nextAiringEpisode { episode airingAt } coverImage { medium } } } }')

    fetchMock.mockClear()
    expect((await anilist().byMalIds([1, 2])).media).toEqual({ 1: media(1), 2: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refetches after the cache expires', async () => {
    fetchMock.mockResolvedValueOnce(page([media(1)]))
    await anilist().byMalIds([1])
    t += ANILIST_TTL_MS + 1
    fetchMock.mockResolvedValueOnce(page([media(1)]))
    await anilist().byMalIds([1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps each entry as long as its own freshness says', async () => {
    fetchMock.mockResolvedValueOnce(page([media(1)]))
    await anilist().byMalIds([1])
    t += 2 * 24 * 60 * 60 * 1000
    const day = () => 24 * 60 * 60 * 1000
    fetchMock.mockClear()
    await anilist().byMalIds([1], () => 30 * day())
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(page([media(1)]))
    await anilist().byMalIds([1], () => day())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetches again once when a cached relation lacks the sequel\'s airing fields (#66)', async () => {
    const before = { ...media(1), relations: { edges: [{ relationType: 'SEQUEL', node: { id: 5, idMal: 2, format: 'TV', startDate: { year: 2027 } } }] } }
    const after = { ...media(1), relations: { edges: [{ relationType: 'SEQUEL', node: { id: 5, idMal: 2, format: 'TV', startDate: { year: 2027, month: 10, day: null }, nextAiringEpisode: null, coverImage: null } }] } }
    fetchMock.mockResolvedValueOnce(page([before]))
    await anilist().byMalIds([1])
    fetchMock.mockResolvedValueOnce(page([after]))
    expect((await anilist().byMalIds([1])).media[1]).toEqual(after)
    fetchMock.mockClear()
    await anilist().byMalIds([1])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves expired cache when AniList is rate limited', async () => {
    fetchMock.mockResolvedValueOnce(page([media(1)]))
    await anilist().byMalIds([1])
    t += ANILIST_TTL_MS + 1
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }))

    const res = await anilist().byMalIds([1, 3])

    expect(res).toMatchObject({ status: 'rate_limited', retryAfter: 30, media: { 1: media(1) }, missing: [3] })
  })

  it('follows a batch onto its next page when AniList answers more media than IDs (seen 2026-10-10)', async () => {
    const twin = { ...media(2), id: 9999 }
    fetchMock
      .mockResolvedValueOnce(page([media(1), media(2)], true))
      .mockResolvedValueOnce(page([twin, media(3)]))

    const res = await anilist().byMalIds([1, 2, 3])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).variables).toEqual({ ids: [1, 2, 3], page: 2 })
    // The first AniList entry listed for a MAL ID is the one kept.
    expect(res).toMatchObject({ status: 'ok', missing: [], media: { 1: media(1), 2: media(2), 3: media(3) } })
  })

  it('goes on after a failed batch, and reports only that batch as missing (#92)', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1)
    fetchMock
      .mockResolvedValueOnce(page(ids.slice(0, 50).map(media)))
      .mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
      .mockResolvedValueOnce(page(ids.slice(100).map(media)))

    const res = await anilist().byMalIds(ids)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(res.status).toBe('error')
    expect(res.error).toBe('HTTP 502 (<html>502 Bad Gateway</html>)')
    expect(res.missing).toEqual(ids.slice(50, 100))
    expect(res.media[120]).toEqual(media(120))
  })

  it('stops at a rate limit instead of asking for the remaining batches', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1)
    fetchMock
      .mockResolvedValueOnce(page(ids.slice(0, 50).map(media)))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }))

    const res = await anilist().byMalIds(ids)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res).toMatchObject({ status: 'rate_limited', retryAfter: 30 })
    expect(res.missing).toEqual(ids.slice(50))
  })

  it('treats GraphQL errors as a failed call', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: null, errors: [{ message: 'Bad query' }] }))
    const res = await anilist().byMalIds([1])
    expect(res).toMatchObject({ status: 'error', missing: [1] })
    expect(res.error).toContain('Bad query')
  })
})

describe('trakt public lookups', () => {
  const show = (trakt: number, slug: string) => ({ ids: { trakt, slug, tmdb: trakt + 100 }, title: `T ${trakt}`, year: 2020, aired_episodes: 12 })
  const traktPublic = () => createTraktPublic({ db, wrapper: opts().wrapper, env, fetch: fetchMock, now: () => t })

  it('looks a show up by slug, caches it, and caches "not found" without marking Trakt as failing', async () => {
    fetchMock.mockResolvedValueOnce(json(show(1, 'a')))
    expect((await traktPublic().showBySlug('a')).data).toMatchObject({ trakt: 1, slug: 'a', tmdb: 101, title: 'T 1', airedEpisodes: 12 })
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({ 'trakt-api-key': 'trakt-id', 'trakt-api-version': '2' })
    expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty('Authorization')

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await traktPublic().showBySlug('nope')).toEqual({ status: 'ok', data: null })
    expect(db.select().from(sourceAccounts).get()?.lastStatus).toBe('ok')

    fetchMock.mockClear()
    await traktPublic().showBySlug('a')
    await traktPublic().showBySlug('nope')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('finds a show by TMDB ID and lists its seasons', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ score: 1, type: 'show', show: show(2, 'b') }]))
      .mockResolvedValueOnce(json([{ number: 0, title: 'Specials', episode_count: 3 }, { number: 1, title: 'Season 1', episode_count: 12, aired_episodes: 12, images: { poster: ['media.trakt.tv/s1.jpg'] } }]))
    expect((await traktPublic().showByTmdb(102)).data).toMatchObject({ trakt: 2 })
    expect(query(0)).toEqual({ type: 'show' })
    expect((await traktPublic().seasons(2)).data).toEqual([
      { number: 0, title: 'Specials', episodeCount: 3, airedEpisodes: null, poster: null },
      { number: 1, title: 'Season 1', episodeCount: 12, airedEpisodes: 12, poster: 'https://media.trakt.tv/s1.jpg' }
    ])
  })

  it('searches by text, or looks up a pasted trakt.tv link by slug', async () => {
    fetchMock.mockResolvedValueOnce(json([{ score: 5, type: 'show', show: show(3, 'c') }]))
    expect((await traktPublic().search('some title')).data.map(s => s.slug)).toEqual(['c'])
    expect(query(0)).toMatchObject({ query: 'some title', limit: '10' })

    fetchMock.mockResolvedValueOnce(json(show(4, 'the-show')))
    expect((await traktPublic().search('https://trakt.tv/shows/the-show/seasons/2')).data.map(s => s.trakt)).toEqual([4])
    expect(paths().at(-1)).toBe('/shows/the-show')
  })

  it('reads slugs from trakt.tv links only', () => {
    expect(slugFromTraktUrl('https://trakt.tv/shows/one-piece')).toBe('one-piece')
    expect(slugFromTraktUrl('trakt.tv/shows/One-Piece/seasons/3')).toBe('one-piece')
    expect(slugFromTraktUrl('https://evil.example/shows/x')).toBeNull()
    expect(slugFromTraktUrl('one piece')).toBeNull()
  })
})

describe('writes', () => {
  const when = new Date('2026-10-09T10:00:00Z')
  const sent = (i = 0) => fetchMock.mock.calls[i]![1]!

  it('adds one Trakt episode to history by show, season and number', async () => {
    fetchMock.mockResolvedValueOnce(json({ added: { movies: 0, episodes: 1 }, not_found: { shows: [], episodes: [] } }, { status: 201 }))
    const res = await createTraktAdapter(opts()).markWatched(7, { season: 3, number: 7 }, when)
    expect(res).toMatchObject({ ok: true })
    expect(paths()).toEqual(['/sync/history'])
    expect(sent().method).toBe('POST')
    expect(JSON.parse(String(sent().body))).toEqual({ shows: [{ ids: { trakt: 7 }, seasons: [{ number: 3, episodes: [{ number: 7, watched_at: '2026-10-09T10:00:00.000Z' }] }] }] })
    expect((sent().headers as Record<string, string>).Authorization).toBe('Bearer acc')
  })

  it('fails a Trakt write that added nothing', async () => {
    fetchMock.mockResolvedValueOnce(json({ added: { episodes: 0 }, not_found: { shows: [{ ids: { trakt: 7 } }] } }, { status: 201 }))
    const res = await createTraktAdapter(opts()).markWatched(7, { season: 3, number: 7 }, when)
    expect(res).toMatchObject({ ok: false, status: 'error' })
    expect(res.error).toContain('added 0')
  })

  it('marks a Simkl anime episode without a season, and a show episode with one', async () => {
    fetchMock.mockImplementation(async () => json({ added: { episodes: 1 }, not_found: { anime: [], shows: [] } }))
    const simkl = createSimklAdapter(opts())
    expect(await simkl.markWatched('anime', 5, { season: null, number: 12 }, when)).toMatchObject({ ok: true })
    expect(await simkl.markWatched('show', 6, { season: 2, number: 3 }, when)).toMatchObject({ ok: true })
    expect(JSON.parse(String(sent(0).body))).toEqual({ anime: [{ ids: { simkl: 5 }, episodes: [{ number: 12, watched_at: '2026-10-09T10:00:00.000Z' }] }] })
    expect(JSON.parse(String(sent(1).body))).toEqual({ shows: [{ ids: { simkl: 6 }, seasons: [{ number: 2, episodes: [{ number: 3, watched_at: '2026-10-09T10:00:00.000Z' }] }] }] })
    expect(query(0)).toMatchObject({ 'client_id': 'simkl-id', 'app-name': 'tsuzuku' })
  })

  it('sets a Simkl status with the episode, and reads where the item ended up', async () => {
    fetchMock.mockResolvedValueOnce(json({ added: { episodes: 1, statuses: [{ request: {}, response: { status: 'hold', simkl_type: 'anime' } }] }, not_found: { anime: [] } }))
    expect(await createSimklAdapter(opts()).markWatched('anime', 5, { season: null, number: 12 }, when, 'hold')).toMatchObject({ ok: true, listStatus: 'hold' })
    expect(JSON.parse(String(sent(0).body))).toEqual({ anime: [{ ids: { simkl: 5 }, status: 'hold', episodes: [{ number: 12, watched_at: '2026-10-09T10:00:00.000Z' }] }] })
  })

  it('fails a Simkl write whose episode was not found', async () => {
    fetchMock.mockResolvedValueOnce(json({ added: { episodes: 0 }, not_found: { anime: [{ ids: { simkl: 5 } }] } }))
    expect(await createSimklAdapter(opts()).markWatched('anime', 5, { season: null, number: 12 }, when)).toMatchObject({ ok: false })
  })

  it('sets the MAL count, and completed on the final episode', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 'completed', num_episodes_watched: 12 }))
    expect(await createMalAdapter(opts()).setWatched(50, 12, 'completed')).toMatchObject({ ok: true, listStatus: 'completed' })
    expect(sent().method).toBe('PATCH')
    expect(String(sent().body)).toBe('num_watched_episodes=12&status=completed')
    expect(paths()).toEqual(['/v2/anime/50/my_list_status'])
  })

  it('reports a rate limit and writes nothing while the source is blocked', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '30' } }))
    const o = opts()
    expect(await createTraktAdapter(o).markWatched(7, { season: 1, number: 1 }, when)).toMatchObject({ ok: false, status: 'rate_limited', retryAfter: 30 })
    expect(await createTraktAdapter(o).markWatched(7, { season: 1, number: 1 }, when)).toMatchObject({ ok: false, status: 'rate_limited' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not call the source without a token', async () => {
    token = { ok: false, reason: 'auth_expired', error: 'Reconnect needed' } as AccessTokenResult
    expect(await createMalAdapter(opts()).setWatched(50, 3, false)).toMatchObject({ ok: false, status: 'auth_expired' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
