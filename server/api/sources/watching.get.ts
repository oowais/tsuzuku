import { useAdapters } from '../../adapters'

// Step 3: the raw watching list per source, live or from the cache, exactly as each source returned it.
// Sources are fetched side by side; each adapter returns a result instead of throwing, so one failure never blanks the others.
export default defineEventHandler(async () => {
  const { simkl, mal } = useAdapters()
  const [simklResult, malResult] = await Promise.all([simkl.fetchWatching(), mal.fetchWatching()])
  return { simkl: simklResult, mal: malResult }
})
