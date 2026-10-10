import { useAdapters } from '../adapters'
import { nextAiring } from '../adapters/anilist'
import { useDb } from '../db'
import { isDemo } from '../demo'
import { createAcceptedStore } from './accepted-store'
import { entriesFrom, type ListSource, type WatchingLists } from './entries'
import { createMappingStore } from './mapping-store'
import { loadLists, traktTitlesFor } from './mapping-service'
import { getSourceStatuses, useSourceWrapper } from './source-wrapper'
import { explainDifference, type DiffReason, type LoggedWrite } from './diff-reasons'
import { seasonChains } from './seasons'
import { buildUpNext, type Row, type SourceFlags } from './up-next'
import { createWriteLog, type WriteLogItem } from './write-log'

// When the next episode of a caught-up show airs (#62), from each source that knows, never merged.
export interface Upcoming {
  source: 'trakt' | 'anilist'
  episode: string
  title: string | null
  airsAt: string
  url: string
}

// Trakt for a linked Trakt show, AniList for each anime entry. Only caught-up rows ask, and both lookups are
// cached (Trakt for a day, AniList until the cached date has passed).
export async function upcomingFor(row: Row): Promise<Upcoming[]> {
  const out: Upcoming[] = []
  const trakt = row.cells.trakt
  const slug = trakt?.entry?.ids.traktSlug ?? trakt?.ref?.traktSlug
  if (slug && !trakt?.blocked) {
    const res = await useAdapters().traktPublic.nextEpisode(slug)
    const n = res.data
    if (n) out.push({ source: 'trakt', episode: `S${n.season}E${n.number}`, title: n.title, airsAt: n.firstAired, url: `https://trakt.tv/shows/${slug}/seasons/${n.season}/episodes/${n.number}` })
  }
  const malIds = [...new Set([row.cells.simkl?.entry?.ids.mal, row.cells.mal?.entry?.ids.mal].filter((id): id is number => typeof id === 'number'))]
  if (malIds.length) {
    const { media } = await useAdapters().anilist.byMalIds(malIds)
    for (const id of malIds) {
      const m = media[id]
      const n = nextAiring(m)
      if (m && n) out.push({ source: 'anilist', episode: `E${n.episode}`, title: null, airsAt: new Date(n.airingAt * 1000).toISOString(), url: `https://anilist.co/anime/${m.id}` })
    }
  }
  return out
}

// Likely causes per differing row (#78), keyed by row key. No source calls: the write log, and AniList
// season chains from the cache only (an entry not looked up yet simply gets no offset hint).
export async function reasonsFor(rows: Row[]): Promise<Record<string, DiffReason[]>> {
  const differing = rows.filter(r => r.differs)
  if (!differing.length) return {}
  const writes = new Map<string, LoggedWrite[]>()
  for (const w of createWriteLog(useDb()).recent(500)) {
    if (w.action !== 'mark_watched') continue
    const item = w.item as Partial<WriteLogItem>
    if (!item.rowKey) continue
    const list = writes.get(item.rowKey) ?? []
    list.push({ source: w.source, at: w.at, markId: item.markId ?? null, result: w.result })
    writes.set(item.rowKey, list)
  }
  const malIds = differing.flatMap(r => [r.cells.simkl?.entry?.ids.mal, r.cells.mal?.entry?.ids.mal]).filter((id): id is number => typeof id === 'number')
  const anilist = useAdapters().anilist
  const chains = await seasonChains(malIds, async ids => anilist.cachedByMalIds(ids))
  const now = Date.now()
  return Object.fromEntries(differing.map(r => [r.key, explainDifference(r, { writes: writes.get(r.key) ?? [], chains, now })]))
}

// The Up Next rows from the lists as last fetched (the ones the page shows), without calling Trakt, Simkl
// or MAL: for the mark-watched preview, which then opens at once. The confirm still reads every source
// fresh and refuses a write when the source has moved since (decision #13), so a stale preview can never
// write twice. A source whose last read failed counts as stale, a rate-limited one as blocked. Null when a
// list has never been fetched.
export function loadUpNextCached() {
  const wrapper = useSourceWrapper()
  const lists = {
    trakt: wrapper.readCache('trakt', 'up_next'),
    simkl: wrapper.readCache('simkl', 'watching'),
    mal: wrapper.readCache('mal', 'watching')
  } as WatchingLists
  if (!lists.trakt || !lists.simkl || !lists.mal) return null
  const { entries } = entriesFrom(lists)
  const statuses = getSourceStatuses(useDb())
  const flag = (source: ListSource): SourceFlags => {
    const st = statuses.find(x => x.source === source)!
    return { stale: st.status !== null && st.status !== 'ok' && st.status !== 'rate_limited', blocked: st.status === 'rate_limited', retryAfter: st.retryAfter }
  }
  const store = createMappingStore(useDb())
  const rows = buildUpNext({
    entries,
    mappings: store.all(),
    traktTitles: {},
    accepted: createAcceptedStore(useDb()).all(),
    flags: { trakt: flag('trakt'), simkl: flag('simkl'), mal: flag('mal') }
  })
  if (isDemo()) for (const r of rows) r.images = [demoPoster(r)]
  return rows
}

const demoPoster = (r: Row) => `/_demo/poster?key=${encodeURIComponent(r.key)}&title=${encodeURIComponent(r.title)}`

// Reads the three lists and builds the Up Next rows: for the page, and again right before a write.
export async function loadUpNext() {
  const { store, entries, errors, results, lookups } = await loadLists()
  // Season posters for the shows on your Trakt list (cached season lookups, so mostly no calls).
  const traktSeasonPosters: Record<number, Record<number, string>> = {}
  for (const e of entries) {
    if (e.source !== 'trakt' || e.next?.season == null) continue
    const res = await useAdapters().traktPublic.seasons(e.ids.trakt!)
    traktSeasonPosters[e.ids.trakt!] = Object.fromEntries(res.data.filter(s => s.poster).map(s => [s.number, s.poster!]))
  }

  const flags = Object.fromEntries(Object.entries(results).map(([source, r]) => [source, { stale: r.stale, blocked: r.status === 'rate_limited', retryAfter: r.retryAfter }])) as Record<ListSource, SourceFlags>
  const rows = buildUpNext({
    entries,
    mappings: store.all(),
    traktTitles: await traktTitlesFor(store, entries),
    traktSeasonPosters,
    accepted: createAcceptedStore(useDb()).all(),
    flags
  })
  // The fictional shows have no source posters; demo mode draws one per row.
  if (isDemo()) for (const r of rows) r.images = [demoPoster(r)]
  return { rows, errors, results, entries, store, lookups }
}
