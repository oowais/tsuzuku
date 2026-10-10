import { clientCredentials } from '../lib/env'
import { USER_AGENT } from '../lib/oauth/providers'
import { MAX_PAGES, requireToken, sendWrite, type AdapterOptions } from './common'

// Trakt GET /sync/progress/up_next (developer portal API reference, operation getSyncProgressUpNextStandard,
// checked 2026-10-08). Paginated; `limit` is capped by the endpoint (often 250) and defaults low (often 10)
// when omitted. `extended=full` adds show IDs (tmdb, tvdb, imdb), progress.last_watched_at and
// progress.next_episode. The reference lists `sort_by` and `sort_how` but not their values.
const API = 'https://api.trakt.tv'
export const PAGE_LIMIT = 100

// Verified 2026-10-08 (issue #9): the default order is progress.last_watched_at, newest first, and
// sort_how=asc reverses it (the reference's example URL uses asc). Pin desc so the default can't flip.
// sort_by stays unset: its values are undocumented and the default key is the one decision #12 wants.
export const SORT: Record<string, string> = { sort_how: 'desc' }

// The account's slug, for the /users/{slug}/... lists the stats are counted from.
const USER_SLUG_KEY = 'user_slug'
// Trakt caps `limit` at 250 on these lists (seen 2026-10-10).
const STATS_PAGE_LIMIT = 250

// What the stats card shows for Trakt, counted from the lists (#89).
export interface TraktCounts {
  shows_watched: number
  show_plays: number
  // Ratings of shows, seasons and episodes; `distribution` is rating (1-10) -> count.
  ratings: { total: number, distribution: Record<string, number> }
}

// Air dates move, so a calendar answer is used for a few hours, then asked again (#72).
export const CALENDAR_TTL_MS = 6 * 60 * 60 * 1000
// Trakt answers at most 33 days per calendar call: a longer range is cut off at day 33 (seen 2026-10-10,
// X-End-Date of a 34-day request).
export const CALENDAR_MAX_DAYS = 33

export function createTraktAdapter(opts: AdapterOptions & { now?: () => number }) {
  const doFetch = opts.fetch ?? globalThis.fetch
  const now = opts.now ?? Date.now

  const headers = (token: string) => ({
    'Authorization': `Bearer ${token}`,
    'trakt-api-key': clientCredentials('trakt', opts.env).clientId,
    'trakt-api-version': '2',
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json'
  })

  // POST /sync/history (API blueprint, checked 2026-10-09; answer seen the same day): one episode by show ID,
  // season and number. Answers 201 with `added.episodes` and `not_found`. Trakt does not check for duplicate plays, so the
  // caller re-reads up next right before this and only writes the episode that is still next.
  async function markWatched(show: number, episode: { season: number, number: number }, watchedAt: Date) {
    const body = { shows: [{ ids: { trakt: show }, seasons: [{ number: episode.season, episodes: [{ number: episode.number, watched_at: watchedAt.toISOString() }] }] }] }
    return sendWrite(opts, 'trakt', token => doFetch(new URL('/sync/history', API), { method: 'POST', headers: headers(token), body: JSON.stringify(body) }), (data) => {
      const added = (data as { added?: { episodes?: unknown } } | null)?.added?.episodes
      return added === 1 ? null : `Trakt added ${typeof added === 'number' ? added : 'no'} episodes (not found: ${JSON.stringify((data as { not_found?: unknown } | null)?.not_found ?? null)})`
    })
  }

  // POST /sync/ratings (API blueprint, checked 2026-10-09): `shows: [{ ids, rating (1-10), rated_at }]`; "if only a
  // show is passed, only the show itself will be rated" (#65: the show, not its seasons). Answers 201 with
  // `added.shows` and `not_found`. Not yet seen in a real answer.
  async function rateShow(show: number, rating: number, ratedAt: Date) {
    const body = { shows: [{ ids: { trakt: show }, rating, rated_at: ratedAt.toISOString() }] }
    return sendWrite(opts, 'trakt', token => doFetch(new URL('/sync/ratings', API), { method: 'POST', headers: headers(token), body: JSON.stringify(body) }), (data) => {
      const added = (data as { added?: { shows?: unknown } } | null)?.added?.shows
      return added === 1 ? null : `Trakt rated ${typeof added === 'number' ? added : 'no'} shows (not found: ${JSON.stringify((data as { not_found?: unknown } | null)?.not_found ?? null)})`
    })
  }

  // GET /sync/ratings/shows (API blueprint, checked 2026-10-09): your rated shows as `{ rated_at, rating, type,
  // show: { ids } }`. Not yet seen in a real answer. Read when a finale preview offers a rating, to show what Trakt
  // has now; `rating` is null for an unrated show, `error` when unreadable.
  async function showRating(show: number): Promise<{ rating: number | null, error?: string }> {
    let token: string
    try {
      token = await requireToken(opts.oauth, 'trakt')
    } catch (err) {
      return { rating: null, error: (err as Error).message }
    }
    const res = await opts.wrapper.call<unknown>({ source: 'trakt', fetcher: () => doFetch(new URL('/sync/ratings/shows', API), { headers: headers(token) }) })
    if (res.status !== 'ok' || !Array.isArray(res.data)) return { rating: null, error: res.error ?? res.status }
    const found = (res.data as { rating?: unknown, show?: { ids?: { trakt?: unknown } } }[]).find(r => r.show?.ids?.trakt === show)
    return { rating: typeof found?.rating === 'number' ? found.rating : null }
  }

  async function fetchUpNext() {
    return opts.wrapper.run<unknown[]>('trakt', 'up_next', async ({ request }) => {
      const token = await requireToken(opts.oauth, 'trakt')
      const { clientId } = clientCredentials('trakt', opts.env)

      const items: unknown[] = []
      for (let page = 1; ; page++) {
        if (page > MAX_PAGES) throw new Error(`Trakt up_next has more than ${MAX_PAGES} pages`)
        const url = new URL('/sync/progress/up_next', API)
        url.search = new URLSearchParams({ extended: 'full', page: String(page), limit: String(PAGE_LIMIT), ...SORT }).toString()
        const { data, headers } = await request<unknown[]>(() => doFetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'trakt-api-key': clientId,
            'trakt-api-version': '2',
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json'
          }
        }))
        if (!Array.isArray(data)) throw new Error('Trakt up_next did not return a list')
        items.push(...data)
        // A short page is always the last one. The page count header is not trusted on its own: on 2026-10-08
        // page 1 returned 9 items with x-pagination-item-count=1337 and page-count=14, and page 2 was empty.
        const pageCount = Number(headers.get('x-pagination-page-count'))
        if (data.length < PAGE_LIMIT || (pageCount > 0 && page >= pageCount)) break
      }
      return items
    })
  }

  // Trakt's stats endpoint answers 204 with an empty body for this account, both `/users/me/stats` and
  // `/users/{slug}/stats` (seen 2026-10-10, #89), so the figures are counted from the lists instead (shows only,
  // movies are out of scope, #90). Both lists are read by the account's slug, from GET /users/settings
  // (`user.ids.slug`), kept after the first lookup; the token goes along so a private profile still answers.
  // Checked live 2026-10-10 against the profile page: 332 shows (site 333), plays match, ratings match.
  // - GET /users/{slug}/watched/shows: always paged (100 by default, `limit` capped at 250); `{ plays, show }`.
  // - GET /users/{slug}/ratings: everything in one answer without page params; `{ rating, type }`.
  // Only the counts are kept, not the lists (about 1 MB).
  async function fetchStats() {
    return opts.wrapper.run<TraktCounts>('trakt', 'stats', async ({ request }) => {
      const token = await requireToken(opts.oauth, 'trakt')
      let slug = opts.wrapper.readCache('trakt', USER_SLUG_KEY) as string | undefined
      if (typeof slug !== 'string') {
        const { data } = await request<{ user?: { ids?: { slug?: unknown } } }>(() => doFetch(new URL('/users/settings', API), { headers: headers(token) }))
        const found = data?.user?.ids?.slug
        if (typeof found !== 'string' || !found) throw new Error('Trakt settings without user.ids.slug')
        slug = found
        opts.wrapper.writeCache('trakt', USER_SLUG_KEY, slug)
      }

      // Follows the pages the answer says it has. A page without pagination headers is the whole list.
      const list = async (path: string, first: Record<string, string>) => {
        const items: unknown[] = []
        let query = first
        for (let page = 1; ; page++) {
          if (page > MAX_PAGES) throw new Error(`Trakt ${path} has more than ${MAX_PAGES} pages`)
          const url = new URL(`/users/${encodeURIComponent(slug!)}${path}`, API)
          url.search = new URLSearchParams(query).toString()
          const { data, headers: h } = await request<unknown[] | null>(() => doFetch(url, { headers: headers(token) }))
          if (data !== null && !Array.isArray(data)) throw new Error(`Trakt ${path} did not return a list`)
          items.push(...(data ?? []))
          const pageCount = Number(h.get('x-pagination-page-count'))
          if (!data?.length || !(pageCount > page)) break
          query = { page: String(page + 1), limit: h.get('x-pagination-limit') ?? String(STATS_PAGE_LIMIT) }
        }
        return items
      }

      const shows = await list('/watched/shows', { page: '1', limit: String(STATS_PAGE_LIMIT) }) as { plays?: unknown }[]
      const ratings = (await list('/ratings', {}) as { rating?: unknown, type?: unknown }[]).filter(r => r.type !== 'movie')
      const distribution: Record<string, number> = {}
      for (const r of ratings) if (typeof r.rating === 'number') distribution[r.rating] = (distribution[r.rating] ?? 0) + 1
      return {
        shows_watched: shows.length,
        show_plays: shows.reduce((n, s) => n + (typeof s.plays === 'number' ? s.plays : 0), 0),
        ratings: { total: ratings.length, distribution }
      }
    })
  }

  // GET /calendars/my/shows/{start_date}/{days} (#72): the episodes of your shows airing in the range, as
  // `{ first_aired, episode { season, number, title }, show { title, ids } }`. Shape seen 2026-10-10 on the public
  // /calendars/all/shows, which takes the same parameters; the "my" one needs the token (401 without).
  // Not paged. Shows you hid from the calendar on Trakt are left out by Trakt.
  async function calendar(startDate: string, days: number) {
    const key = `calendar:${startDate}:${days}`
    const cachedAt = opts.wrapper.cachedAt('trakt', key)
    if (cachedAt && now() - cachedAt.getTime() < CALENDAR_TTL_MS) {
      return { source: 'trakt' as const, status: 'ok' as const, data: opts.wrapper.readCache('trakt', key) as unknown[], fetchedAt: cachedAt, retryAfter: null, stale: false }
    }
    return opts.wrapper.run<unknown[]>('trakt', key, async ({ request }) => {
      const token = await requireToken(opts.oauth, 'trakt')
      const url = new URL(`/calendars/my/shows/${startDate}/${Math.min(days, CALENDAR_MAX_DAYS)}`, API)
      const { data } = await request<unknown[] | null>(() => doFetch(url, { headers: headers(token) }))
      if (data !== null && !Array.isArray(data)) throw new Error('Trakt calendar did not return a list')
      return data ?? []
    })
  }

  return { fetchUpNext, markWatched, rateShow, showRating, fetchStats, calendar }
}
