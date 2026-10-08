import { clientCredentials } from '../lib/env'
import { APP_NAME, APP_VERSION, USER_AGENT } from '../lib/oauth/providers'
import { requireToken, type AdapterOptions } from './common'

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

  return { fetchWatching }
}
