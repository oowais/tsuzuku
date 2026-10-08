import { useAdapters } from '../adapters'
import { useDb } from '../db'
import { createAcceptedStore } from './accepted-store'
import type { ListSource } from './entries'
import { loadLists, traktTitlesFor } from './mapping-service'
import { buildUpNext, type SourceFlags } from './up-next'

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
  return { rows, errors, results }
}
