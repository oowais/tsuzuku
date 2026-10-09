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
  // `finishDate` (YYYY-MM-DD, `finish_date`) goes with Completed when the entry has none (the caller checks).
  // `score` (0-10, 0 clears it; #65) goes in the same PATCH; the answer's `score` is checked against it.
  async function setWatched(malId: number, watched: number, status: 'completed' | 'on_hold' | 'dropped' | null = null, finishDate: string | null = null, score: number | null = null) {
    const form = new URLSearchParams({ num_watched_episodes: String(watched), ...(status ? { status } : {}), ...(finishDate ? { finish_date: finishDate } : {}), ...(score !== null ? { score: String(score) } : {}) })
    return sendWrite(opts, 'mal', token => doFetch(`${API}/anime/${malId}/my_list_status`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    }), (data) => {
      const answer = data as { num_episodes_watched?: unknown, score?: unknown } | null
      const count = answer?.num_episodes_watched
      if (typeof count === 'number' && count !== watched) return `MAL now says ${count} watched, expected ${watched}`
      return score !== null && answer?.score !== score ? `MAL now says score ${typeof answer?.score === 'number' ? answer.score : 'nothing'}, expected ${score}` : null
    }, (data) => {
      const status = (data as { status?: unknown } | null)?.status
      return typeof status === 'string' ? status : null
    })
  }

  // GET /anime/{id}?fields=my_list_status (API v2 reference, checked 2026-10-09): `my_list_status` is left out
  // when the anime is not on your list; its `start_date` (YYYY-MM-DD) only once one is set. Seen 2026-10-09 (Plan
  // to Watch). Read before starting a season (#66), so an entry already on the list is never moved and a start
  // date you set is kept. Null `status` means not on the list; `error` when unreadable.
  async function listStatus(malId: number): Promise<{ status: string | null, watched: number | null, startDate: string | null, finishDate: string | null, error?: string }> {
    let token: string
    try {
      token = await requireToken(opts.oauth, 'mal')
    } catch (err) {
      return { status: null, watched: null, startDate: null, finishDate: null, error: (err as Error).message }
    }
    const url = new URL(`${API}/anime/${malId}`)
    url.search = new URLSearchParams({ fields: 'my_list_status' }).toString()
    const res = await opts.wrapper.call<{ my_list_status?: { status?: unknown, num_episodes_watched?: unknown, start_date?: unknown, finish_date?: unknown } }>({
      source: 'mal',
      fetcher: () => doFetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } })
    })
    if (res.status !== 'ok' || !res.data) return { status: null, watched: null, startDate: null, finishDate: null, error: res.error ?? res.status }
    const ls = res.data.my_list_status
    return {
      status: typeof ls?.status === 'string' ? ls.status : null,
      watched: typeof ls?.num_episodes_watched === 'number' ? ls.num_episodes_watched : null,
      startDate: typeof ls?.start_date === 'string' && ls.start_date ? ls.start_date : null,
      finishDate: typeof ls?.finish_date === 'string' && ls.finish_date ? ls.finish_date : null
    }
  }

  // Puts an anime on Watching (#66): PATCH with `status`, never a watched count, so progress MAL already has is
  // never reset. `startDate` (YYYY-MM-DD, `start_date` in the API v2 reference) only when the entry has none.
  async function startWatching(malId: number, startDate: string | null = null) {
    return sendWrite(opts, 'mal', token => doFetch(`${API}/anime/${malId}/my_list_status`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: 'watching', ...(startDate ? { start_date: startDate } : {}) }).toString()
    }), (data) => {
      const status = (data as { status?: unknown } | null)?.status
      return status === 'watching' ? null : `MAL now says ${typeof status === 'string' ? status : 'nothing'}, expected watching`
    }, data => ((data as { status?: unknown } | null)?.status as string | undefined) ?? null)
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

  return { fetchWatching, setWatched, fetchStats, listStatus, startWatching }
}
