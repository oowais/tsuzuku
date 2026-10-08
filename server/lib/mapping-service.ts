import { useAdapters } from '../adapters'
import type { TraktShow } from '../adapters/trakt-public'
import { useDb } from '../db'
import { entriesFrom, type Entry, type WatchingLists } from './entries'
import { linkByIds } from './mapping'
import { buildProposals, createMappingStore, traktRefFromShow, type TraktLookups, type TraktRef } from './mapping-store'
import { seasonChains } from './seasons'
import { useSourceWrapper } from './source-wrapper'

// Ties the lists, ID links, Trakt lookups, AniList chains and stored mappings together for /api/mappings.

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

// A Trakt show by ID: from your up-next list when it is there, else confirmed by asking Trakt.
// Null when Trakt does not know it, so a made-up ID can never be stored.
export async function resolveTraktShow(traktId: number, entries = cachedEntries()): Promise<TraktRef | null> {
  const listed = entries.find(e => e.source === 'trakt' && e.ids.trakt === traktId)
  if (listed) return { trakt: traktId, slug: listed.ids.traktSlug ?? null, tmdb: listed.ids.tmdb ?? null, title: listed.title, year: listed.year, next: listed.next, onList: true }
  const res = await useAdapters().traktPublic.showById(traktId)
  return res.data ? traktRefFromShow(res.data) : null
}

// Simkl names the Trakt show for most items (`traktslug`, else a TMDB ID). Asking Trakt confirms the show
// exists and gives its Trakt ID. Lookups are cached, and a stored link is not looked up again.
async function lookupTraktShows(entries: Entry[], store: ReturnType<typeof createMappingStore>): Promise<TraktLookups & { blocked: boolean }> {
  const { traktPublic } = useAdapters()
  const lookups: TraktLookups = { byMal: new Map(), byTrakt: new Map() }
  let blocked = false
  const find = async (e: Entry): Promise<TraktShow | null> => {
    const res = e.ids.traktSlug
      ? await traktPublic.showBySlug(e.ids.traktSlug)
      : e.ids.tmdb !== undefined ? await traktPublic.showByTmdb(e.ids.tmdb) : null
    if (res && res.status !== 'ok') blocked = true
    return res?.data ?? null
  }
  const onList = new Set(entries.filter(e => e.source === 'trakt').map(e => e.ids.trakt))

  for (const e of entries) {
    if (e.source !== 'simkl' || blocked) continue
    if (e.kind === 'show') {
      // Non-anime shows link at show level (decision #15), straight from the ID.
      if (store.mappingBySimkl(e.ids.simkl!)?.traktId != null) continue
      const show = await find(e)
      if (show) store.linkShow(e, traktRefFromShow(show))
      continue
    }
    const malId = e.ids.mal
    if (malId === undefined) continue
    const season = store.seasonFor({ mal: malId, simkl: e.ids.simkl })
    const owner = season ? store.mappingById(season.mappingId) : undefined
    if (season?.traktSeason != null || owner?.traktId != null) continue
    const show = await find(e)
    if (show) lookups.byMal.set(malId, traktRefFromShow(show))
  }

  // Stored links whose Trakt show is not on your up-next list right now.
  for (const s of store.unplaced()) {
    const owner = store.mappingById(s.mappingId)
    if (owner?.traktId == null || onList.has(owner.traktId) || blocked) continue
    const ref = await resolveTraktShow(owner.traktId, entries)
    if (ref) lookups.byTrakt.set(owner.traktId, ref)
  }
  return { ...lookups, blocked }
}

export async function mappingOverview() {
  const { trakt, simkl, mal, anilist } = useAdapters()
  const store = createMappingStore(useDb())
  const [traktRes, simklRes, malRes] = await Promise.all([trakt.fetchUpNext(), simkl.fetchWatching(), mal.fetchWatching()])
  const { entries, errors } = entriesFrom({ trakt: traktRes.data, simkl: simklRes.data, mal: malRes.data })

  store.syncAutoLinks(entries, linkByIds(entries))
  const lookups = await lookupTraktShows(entries, store)

  let anilistStatus: { status: string, retryAfter: number | null, error?: string } = { status: 'ok', retryAfter: null }
  const malIds = entries.filter(e => e.kind === 'anime' && e.ids.mal !== undefined).map(e => e.ids.mal!)
  const chains = await seasonChains(malIds, async (ids) => {
    const res = await anilist.byMalIds(ids)
    if (res.status !== 'ok') anilistStatus = { status: res.status, retryAfter: res.retryAfter, error: res.error }
    return res.media
  })

  const status = (r: typeof traktRes | typeof simklRes | typeof malRes) => ({ status: r.status, stale: r.stale, retryAfter: r.retryAfter, error: r.error })
  return {
    sources: { trakt: status(traktRes), simkl: status(simklRes), mal: status(malRes), anilist: anilistStatus, traktLookups: { blocked: lookups.blocked } },
    entries,
    errors,
    proposals: buildProposals(entries, chains, store, lookups),
    mappings: store.all(),
    // Per MAL ID, the seasons from the first one to this entry as AniList knows them. The first season's
    // title is the best text to search Trakt with, since Trakt names the whole show.
    chains: Object.fromEntries(Object.entries(chains).map(([malId, chain]) => [malId, chain.map(c => ({
      malId: c.malId, title: c.titles[0] ?? `MAL ${c.malId}`, format: c.format, episodes: c.episodes, year: c.year
    }))]))
  }
}
