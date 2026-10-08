import { useAdapters } from '../adapters'
import { useDb } from '../db'
import { entriesFrom, type Entry, type WatchingLists } from './entries'
import { linkByIds } from './mapping'
import { buildProposals, createMappingStore } from './mapping-store'
import { seasonChains } from './seasons'
import { useSourceWrapper } from './source-wrapper'

// Ties the lists, ID links, AniList chains and stored mappings together for the /api/mappings routes.

// The lists as last fetched, without calling any source. Used to check that confirmed IDs are real.
export function cachedEntries(): Entry[] {
  const wrapper = useSourceWrapper()
  const lists: WatchingLists = {
    trakt: wrapper.readCache('trakt', 'up_next') as WatchingLists['trakt'],
    simkl: wrapper.readCache('simkl', 'watching') as WatchingLists['simkl'],
    mal: wrapper.readCache('mal', 'watching') as WatchingLists['mal']
  }
  return entriesFrom(lists).entries
}

export async function mappingOverview() {
  const { trakt, simkl, mal, anilist } = useAdapters()
  const store = createMappingStore(useDb())
  const [traktRes, simklRes, malRes] = await Promise.all([trakt.fetchUpNext(), simkl.fetchWatching(), mal.fetchWatching()])
  const { entries, errors } = entriesFrom({ trakt: traktRes.data, simkl: simklRes.data, mal: malRes.data })

  store.syncAutoLinks(entries, linkByIds(entries))

  let anilistStatus: { status: string, retryAfter: number | null, error?: string } = { status: 'ok', retryAfter: null }
  const malIds = entries.filter(e => e.kind === 'anime' && e.ids.mal !== undefined).map(e => e.ids.mal!)
  const chains = await seasonChains(malIds, async (ids) => {
    const res = await anilist.byMalIds(ids)
    if (res.status !== 'ok') anilistStatus = { status: res.status, retryAfter: res.retryAfter, error: res.error }
    return res.media
  })

  const status = (r: typeof traktRes | typeof simklRes | typeof malRes) => ({ status: r.status, stale: r.stale, retryAfter: r.retryAfter, error: r.error })
  return {
    sources: { trakt: status(traktRes), simkl: status(simklRes), mal: status(malRes), anilist: anilistStatus },
    entries,
    errors,
    proposals: buildProposals(entries, chains, store),
    mappings: store.all()
  }
}
