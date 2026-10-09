import { clientCredentials } from '../lib/env'
import { APP_NAME, APP_VERSION, USER_AGENT } from '../lib/oauth/providers'
import { requireToken, sendWrite, type AdapterOptions } from './common'

// Simkl API: https://api.simkl.org/llms.txt (checked 2026-10-08). Simkl suspends a client_id that polls
// /sync/all-items without first checking /sync/activities, so every read follows their sync guide:
// - /sync/activities first; an unchanged top-level `all` means nothing moved and nothing else is called.
// - The first run pulls the watching lists in full; the activities snapshot is read before that pull.
// - Later runs fetch only items changed since the snapshot (`date_from`) and merge them in.
// - A moved `removed_from_list` triggers an ID-only fetch to find deletions, which `date_from` never returns.
// - The snapshot is saved only after every request succeeded, so a failed run is retried from the old one.
const API = 'https://api.simkl.com'

// Activities block name and the matching /sync/all-items type segment, which is also the response key.
const TYPES = [
  { block: 'tv_shows', type: 'shows' },
  { block: 'anime', type: 'anime' }
] as const
type ItemType = (typeof TYPES)[number]['type']

// Timestamps that move when an item enters or leaves a list, or an episode is marked.
const LIST_BUCKETS = ['watching', 'plantowatch', 'hold', 'completed', 'dropped'] as const

// Raw Simkl item. Only `status` and `show.ids.simkl` are relied on, both from the documented example.
export interface SimklItem {
  status?: string
  show?: { ids?: { simkl?: number } }
  [key: string]: unknown
}

export type SimklWatching = Record<ItemType, SimklItem[]>
type Activities = { all?: string } & Record<string, unknown>

const ACTIVITIES_KEY = 'activities'
// The numeric Simkl account id, for /users/{id}/stats.
const ACCOUNT_KEY = 'account_id'

function simklId(item: SimklItem): number {
  const id = item.show?.ids?.simkl
  if (typeof id !== 'number') throw new Error('Simkl item without show.ids.simkl')
  return id
}

// A delta item replaces the cached one; an item whose status is no longer `watching` leaves the list.
export function mergeDelta(list: SimklItem[], delta: SimklItem[]): SimklItem[] {
  const byId = new Map(list.map(item => [simklId(item), item]))
  for (const item of delta) {
    if (item.status === 'watching') byId.set(simklId(item), item)
    else byId.delete(simklId(item))
  }
  return [...byId.values()]
}

function bucket(activities: Activities | undefined, block: string, name: string): unknown {
  const value = activities?.[block]
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[name] : undefined
}

export function createSimklAdapter(opts: AdapterOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch
  const { wrapper } = opts

  async function fetchWatching() {
    let snapshot: Activities | undefined

    const res = await wrapper.run<SimklWatching>('simkl', 'watching', async ({ cached, request }) => {
      const token = await requireToken(opts.oauth, 'simkl')
      const { clientId } = clientCredentials('simkl', opts.env)

      const get = async <R>(path: string, params: Record<string, string> = {}) => {
        const url = new URL(path, API)
        url.search = new URLSearchParams({ ...params, 'client_id': clientId, 'app-name': APP_NAME, 'app-version': APP_VERSION }).toString()
        const { data } = await request<R>(() => doFetch(url, {
          headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT }
        }))
        return data
      }
      const items = (data: Partial<Record<ItemType, SimklItem[]>> | null, type: ItemType) => data?.[type] ?? []

      const previous = wrapper.readCache('simkl', ACTIVITIES_KEY) as Activities | undefined
      snapshot = await get<Activities>('/sync/activities')

      if (!cached || !previous?.all) {
        const list = {} as SimklWatching
        for (const { type } of TYPES) {
          const data = await get<Partial<Record<ItemType, SimklItem[]>>>(`/sync/all-items/${type}/watching`, { next_watch_info: 'yes' })
          list[type] = items(data, type)
          list[type].forEach(simklId)
        }
        return list
      }

      if (snapshot.all === previous.all) return cached

      const list = { ...cached }
      for (const { block, type } of TYPES) {
        if (LIST_BUCKETS.some(name => bucket(snapshot, block, name) !== bucket(previous, block, name))) {
          const data = await get<Partial<Record<ItemType, SimklItem[]>>>(`/sync/all-items/${type}`, { date_from: previous.all, next_watch_info: 'yes' })
          list[type] = mergeDelta(list[type] ?? [], items(data, type))
        }
        if (bucket(snapshot, block, 'removed_from_list') !== bucket(previous, block, 'removed_from_list')) {
          const data = await get<Partial<Record<ItemType, SimklItem[]>>>(`/sync/all-items/${type}/watching`, { extended: 'simkl_ids_only' })
          const remaining = new Set(items(data, type).map(simklId))
          list[type] = (list[type] ?? []).filter(item => remaining.has(simklId(item)))
        }
      }
      return list
    })

    // After the list is cached: a crash in between only means the next run re-fetches the same delta.
    if (res.status === 'ok' && snapshot) wrapper.writeCache('simkl', ACTIVITIES_KEY, snapshot)
    return res
  }

  // POST /sync/history (llms.txt, checked 2026-10-09). Shows take seasons; anime take episodes only, each
  // Simkl anime entry numbering its own episodes. Seen 2026-10-09: answers 201 with `added.episodes` and `not_found`.
  // A per-item `status` moves the item in the same call (add-to-history reference, checked 2026-10-09); without
  // it Simkl files the item itself, e.g. Completed after the last episode. `added.statuses[].response.status` is
  // where the item ended up (not yet seen in a real answer).
  async function markWatched(kind: 'show' | 'anime', simkl: number, episode: { season: number | null, number: number }, watchedAt: Date, status: 'hold' | 'dropped' | null = null) {
    const ep = { number: episode.number, watched_at: watchedAt.toISOString() }
    const item = { ids: { simkl }, ...(status ? { status } : {}) }
    let body: object
    if (kind === 'anime') body = { anime: [{ ...item, episodes: [ep] }] }
    else if (episode.season !== null) body = { shows: [{ ...item, seasons: [{ number: episode.season, episodes: [ep] }] }] }
    else return { ok: false, status: 'error' as const, retryAfter: null, error: 'Simkl show episode without a season' }

    const { clientId } = clientCredentials('simkl', opts.env)
    const url = new URL('/sync/history', API)
    url.search = new URLSearchParams({ 'client_id': clientId, 'app-name': APP_NAME, 'app-version': APP_VERSION }).toString()
    return sendWrite(opts, 'simkl', token => doFetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }), (data) => {
      const answer = (data ?? {}) as { added?: unknown, not_found?: unknown }
      const notFound = Object.values(answer.not_found && typeof answer.not_found === 'object' ? answer.not_found : {}).some(v => Array.isArray(v) && v.length > 0)
      const added = (answer.added as { episodes?: unknown } | undefined)?.episodes
      if (notFound) return `Simkl did not find the episode (${JSON.stringify(answer.not_found)})`
      return typeof added === 'number' && added >= 1 ? null : `Simkl added ${typeof added === 'number' ? added : 'no'} episodes`
    }, (data) => {
      const statuses = ((data as { added?: { statuses?: unknown } } | null)?.added?.statuses)
      const first = Array.isArray(statuses) ? (statuses[0] as { response?: { status?: unknown } } | undefined)?.response?.status : undefined
      return typeof first === 'string' ? first : null
    })
  }

  // POST /sync/ratings (api.simkl.org add-ratings reference, checked 2026-10-09): `movies`, `shows` and `anime`
  // arrays of `{ ids, rating (1-10), rated_at? }`; posting again overwrites. Answers 201 with `added.shows` (anime
  // count under shows too) and `not_found`; an out-of-range rating still answers 201 and lands in `not_found`.
  // Not yet seen in a real answer. #65.
  async function rate(kind: 'show' | 'anime', simkl: number, rating: number, ratedAt: Date) {
    const { clientId } = clientCredentials('simkl', opts.env)
    const url = new URL('/sync/ratings', API)
    url.search = new URLSearchParams({ 'client_id': clientId, 'app-name': APP_NAME, 'app-version': APP_VERSION }).toString()
    const item = [{ ids: { simkl }, rating, rated_at: ratedAt.toISOString() }]
    return sendWrite(opts, 'simkl', token => doFetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'anime' ? { anime: item } : { shows: item })
    }), (data) => {
      const answer = (data ?? {}) as { added?: { shows?: unknown }, not_found?: unknown }
      const notFound = Object.values(answer.not_found && typeof answer.not_found === 'object' ? answer.not_found : {}).some(v => Array.isArray(v) && v.length > 0)
      if (notFound) return `Simkl did not take the rating (${JSON.stringify(answer.not_found)})`
      return typeof answer.added?.shows === 'number' && answer.added.shows >= 1 ? null : `Simkl rated ${typeof answer.added?.shows === 'number' ? answer.added.shows : 'nothing'}`
    })
  }

  // POST /sync/add-to-list (Simkl API reference, checked 2026-10-09): `shows: [{ to, ids }]`; the reference's
  // own example adds an anime by its `mal` ID this way. Answers with `added.shows` and `not_found.shows`. Not
  // yet seen in a real answer. Starts the next anime season on Watching (#66); an item already on another
  // list moves to Watching.
  async function addToWatching(malId: number) {
    const { clientId } = clientCredentials('simkl', opts.env)
    const url = new URL('/sync/add-to-list', API)
    url.search = new URLSearchParams({ 'client_id': clientId, 'app-name': APP_NAME, 'app-version': APP_VERSION }).toString()
    return sendWrite(opts, 'simkl', token => doFetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ shows: [{ to: 'watching', ids: { mal: malId } }] })
    }), (data) => {
      const answer = (data ?? {}) as { added?: { shows?: unknown }, not_found?: { shows?: unknown } }
      if (Array.isArray(answer.not_found?.shows) && answer.not_found.shows.length) return 'Simkl did not find this anime by its MAL ID'
      return Array.isArray(answer.added?.shows) && answer.added.shows.length ? null : `Simkl added nothing (${JSON.stringify(data)})`
    }, data => (Array.isArray((data as { added?: { shows?: unknown } } | null)?.added?.shows) ? 'watching' : null))
  }

  // GET /users/{user_id}/stats (api.simkl.org, checked 2026-10-09). Simkl's most expensive call, computed live
  // from the whole history: only on an explicit request (the stats page keeps it for hours). It needs the
  // numeric account id from GET /users/settings (`account.id`), kept after the first lookup. Not yet seen in a
  // real answer.
  async function fetchStats() {
    return wrapper.run<unknown>('simkl', 'stats', async ({ request }) => {
      const token = await requireToken(opts.oauth, 'simkl')
      const { clientId } = clientCredentials('simkl', opts.env)
      const get = async <R>(path: string) => {
        const url = new URL(path, API)
        url.search = new URLSearchParams({ 'client_id': clientId, 'app-name': APP_NAME, 'app-version': APP_VERSION }).toString()
        return (await request<R>(() => doFetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } }))).data
      }
      let id = wrapper.readCache('simkl', ACCOUNT_KEY) as number | undefined
      if (typeof id !== 'number') {
        const settings = await get<{ account?: { id?: unknown } }>('/users/settings')
        const found = settings?.account?.id
        if (typeof found !== 'number' || found <= 0) throw new Error('Simkl settings without account.id')
        id = found
        wrapper.writeCache('simkl', ACCOUNT_KEY, id)
      }
      return await get<unknown>(`/users/${id}/stats`)
    })
  }

  return { fetchWatching, markWatched, rate, fetchStats, addToWatching }
}
