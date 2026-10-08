import { useAdapters } from '../adapters'
import { loadLists, traktTitlesFor } from '../lib/mapping-service'
import { buildUpNext } from '../lib/up-next'

// The Up Next page: rows per show with each source's own progress, and each source's fetch status.
export default defineEventHandler(async () => {
  const { store, entries, errors, results } = await loadLists()
  // Season posters for the shows on your Trakt list (cached season lookups, so mostly no calls).
  const traktSeasonPosters: Record<number, Record<number, string>> = {}
  for (const e of entries) {
    if (e.source !== 'trakt' || e.next?.season == null) continue
    const res = await useAdapters().traktPublic.seasons(e.ids.trakt!)
    traktSeasonPosters[e.ids.trakt!] = Object.fromEntries(res.data.filter(s => s.poster).map(s => [s.number, s.poster!]))
  }

  const flags = Object.fromEntries(Object.entries(results).map(([source, r]) => [source, { stale: r.stale, blocked: r.status === 'rate_limited' }]))
  const rows = buildUpNext({
    entries,
    mappings: store.all(),
    traktTitles: await traktTitlesFor(store, entries),
    traktSeasonPosters,
    flags: flags as Parameters<typeof buildUpNext>[0]['flags']
  })
  const sources = Object.fromEntries(Object.entries(results).map(([source, r]) => [source, { status: r.status, stale: r.stale, fetchedAt: r.fetchedAt, retryAfter: r.retryAfter, error: r.error }]))
  return { rows, sources, errors }
})
