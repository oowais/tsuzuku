import { USER_AGENT } from '../lib/oauth/providers'
import { MAX_PAGES, requireToken, type AdapterOptions } from './common'

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

  return { fetchWatching }
}
