import { clientCredentials } from '../lib/env'
import { USER_AGENT } from '../lib/oauth/providers'
import { MAX_PAGES, requireToken, type AdapterOptions } from './common'

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
        // The reference documents no paging headers. Use a page count if Trakt sends one, else stop on a short page.
        const pageCount = Number(headers.get('x-pagination-page-count'))
        if (pageCount > 0 ? page >= pageCount : data.length < PAGE_LIMIT) break
      }
      return items
    })
  }

  return { fetchUpNext }
}
