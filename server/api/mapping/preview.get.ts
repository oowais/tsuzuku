import { useAdapters } from '../../adapters'
import { entriesFrom } from '../../lib/entries'
import { linkByIds } from '../../lib/mapping'
import type { SourceResult } from '../../lib/source-wrapper'

// Step 4, first layer: every watching-list entry in one shape, the groups that share a real ID, and the
// AniList entry for every MAL ID seen. Read-only; nothing is stored except caches.
export default defineEventHandler(async () => {
  const { trakt, simkl, mal, anilist } = useAdapters()
  const [traktRes, simklRes, malRes] = await Promise.all([trakt.fetchUpNext(), simkl.fetchWatching(), mal.fetchWatching()])

  const { entries, errors } = entriesFrom({ trakt: traktRes.data, simkl: simklRes.data, mal: malRes.data })
  const malIds = entries.map(e => e.ids.mal).filter((id): id is number => id !== undefined)
  const anilistRes = await anilist.byMalIds(malIds)

  const status = (r: SourceResult<unknown>) => ({ status: r.status, stale: r.stale, fetchedAt: r.fetchedAt, retryAfter: r.retryAfter, error: r.error })
  return {
    sources: { trakt: status(traktRes), simkl: status(simklRes), mal: status(malRes) },
    entries,
    errors,
    groups: linkByIds(entries),
    anilist: anilistRes
  }
})
