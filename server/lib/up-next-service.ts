import { useAdapters } from '../adapters'
import { nextAiring } from '../adapters/anilist'
import { useDb } from '../db'
import { isDemo } from '../demo'
import { createAcceptedStore } from './accepted-store'
import type { ListSource } from './entries'
import { loadLists, traktTitlesFor } from './mapping-service'
import { buildUpNext, type Row, type SourceFlags } from './up-next'

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

// Reads the three lists and builds the Up Next rows: for the page, and again right before a write.
export async function loadUpNext() {
  const { store, entries, errors, results } = await loadLists()
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
  if (isDemo()) for (const r of rows) r.images = [`/_demo/poster?key=${encodeURIComponent(r.key)}&title=${encodeURIComponent(r.title)}`]
  return { rows, errors, results }
}
