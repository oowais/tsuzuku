import { useAdapters } from '../../adapters'

// Step 3: the raw watching list per source, live or from the cache, exactly as each source returned it.
// Sources are fetched side by side; each adapter returns a result instead of throwing, so one failure never blanks the others.
export default defineEventHandler(async () => {
  const { trakt, simkl, mal } = useAdapters()
  const [traktResult, simklResult, malResult] = await Promise.all([trakt.fetchUpNext(), simkl.fetchWatching(), mal.fetchWatching()])
  return { trakt: traktResult, simkl: simklResult, mal: malResult }
})
