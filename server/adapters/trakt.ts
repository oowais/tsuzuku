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

  // GET /users/{id}/stats (API blueprint, checked 2026-10-09; `me` with a token): counts and minutes for
  // movies, shows and episodes, and ratings. Not yet seen in a real answer.
  async function fetchStats() {
    return opts.wrapper.run<unknown>('trakt', 'stats', async ({ request }) => {
      const token = await requireToken(opts.oauth, 'trakt')
      const { data } = await request<unknown>(() => doFetch(new URL('/users/me/stats', API), { headers: headers(token) }))
      return data
    })
  }

  return { fetchUpNext, markWatched, fetchStats }
}
