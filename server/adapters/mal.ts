import { USER_AGENT } from '../lib/oauth/providers'
import { MAX_PAGES, requireToken, sendWrite, type AdapterOptions } from './common'

// MAL API v2: https://myanimelist.net/apiconfig/references/api/v2 (checked 2026-10-08).
// GET /users/@me/animelist, `limit` up to 1000, `paging.next` holds the next page URL.
const API = 'https://api.myanimelist.net/v2'

// Fields requested per entry. The anime's own fields; `list_status` carries the user's progress.
const FIELDS = 'list_status,num_episodes,media_type,status,alternative_titles,start_season,start_date'

// Raw MAL shape, unverified beyond what paging needs.
export interface MalPage {
  data?: unknown[]
  paging?: { next?: string }
}

export interface MalWatching {
  data: unknown[]
}

export function createMalAdapter(opts: AdapterOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch

  async function fetchWatching() {
    return opts.wrapper.run<MalWatching>('mal', 'watching', async ({ request }) => {
      const token = await requireToken(opts.oauth, 'mal')
      const first = new URL(`${API}/users/@me/animelist`)
      first.search = new URLSearchParams({ status: 'watching', sort: 'list_updated_at', limit: '1000', nsfw: 'true', fields: FIELDS }).toString()

      const items: unknown[] = []
      let url: string | undefined = first.toString()
      for (let page = 0; url; page++) {
        if (page === MAX_PAGES) throw new Error(`MAL list has more than ${MAX_PAGES} pages`)
        const target: string = url
        const { data } = await request<MalPage>(() => doFetch(target, {
          headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT }
        }))
        items.push(...(data.data ?? []))
        // Never send the token to a host other than the API.
        url = data.paging?.next?.startsWith(`${API}/`) ? data.paging.next : undefined
      }
      return { data: items }
    })
  }

  // PATCH /anime/{id}/my_list_status (API v2 reference, checked 2026-10-09): form fields
  // `num_watched_episodes` and `status`; only the fields sent change. Seen 2026-10-09: the answer is the
  // list status, whose `num_episodes_watched` has to be the new count. `status` is one of watching, completed,
  // on_hold, dropped, plan_to_watch; left out, it stays as it is.
  async function setWatched(malId: number, watched: number, status: 'completed' | 'on_hold' | 'dropped' | null = null) {
    const form = new URLSearchParams({ num_watched_episodes: String(watched), ...(status ? { status } : {}) })
    return sendWrite(opts, 'mal', token => doFetch(`${API}/anime/${malId}/my_list_status`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    }), (data) => {
      const count = (data as { num_episodes_watched?: unknown } | null)?.num_episodes_watched
      return typeof count === 'number' && count !== watched ? `MAL now says ${count} watched, expected ${watched}` : null
    }, (data) => {
      const status = (data as { status?: unknown } | null)?.status
      return typeof status === 'string' ? status : null
    })
  }

  // GET /users/@me?fields=anime_statistics (API v2 reference, checked 2026-10-09): counts per list status,
  // days, episodes and mean score. Not yet seen in a real answer.
  async function fetchStats() {
    return opts.wrapper.run<unknown>('mal', 'stats', async ({ request }) => {
      const token = await requireToken(opts.oauth, 'mal')
      const url = new URL(`${API}/users/@me`)
      url.search = new URLSearchParams({ fields: 'anime_statistics' }).toString()
      const { data } = await request<unknown>(() => doFetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } }))
      return data
    })
  }

  return { fetchWatching, setWatched, fetchStats }
}
