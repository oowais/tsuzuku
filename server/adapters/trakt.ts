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

// The account's slug, for /users/{slug}/stats.
const USER_SLUG_KEY = 'user_slug'

export function createTraktAdapter(opts: AdapterOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch

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

  // GET /users/{id}/stats (API blueprint, checked 2026-10-09): counts and minutes for movies, shows and
  // episodes, and ratings. Seen 2026-10-09: `/users/me/stats` answers 204 with an empty body, so the stats are
  // asked for by the account's slug, from GET /users/settings (`user.ids.slug`), kept after the first lookup.
  // The token goes along so a private profile still answers.
  async function fetchStats() {
    return opts.wrapper.run<unknown>('trakt', 'stats', async ({ request }) => {
      const token = await requireToken(opts.oauth, 'trakt')
      let slug = opts.wrapper.readCache('trakt', USER_SLUG_KEY) as string | undefined
      if (typeof slug !== 'string') {
        const { data } = await request<{ user?: { ids?: { slug?: unknown } } }>(() => doFetch(new URL('/users/settings', API), { headers: headers(token) }))
        const found = data?.user?.ids?.slug
        if (typeof found !== 'string' || !found) throw new Error('Trakt settings without user.ids.slug')
        slug = found
        opts.wrapper.writeCache('trakt', USER_SLUG_KEY, slug)
      }
      const { data } = await request<unknown>(() => doFetch(new URL(`/users/${encodeURIComponent(slug!)}/stats`, API), { headers: headers(token) }))
      return data
    })
  }

  return { fetchUpNext, markWatched, rateShow, showRating, fetchStats }
}
