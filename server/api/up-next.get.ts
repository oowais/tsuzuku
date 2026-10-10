import { proposalCount } from '../lib/mapping-service'
import { startable } from '../lib/next-season'
import { loadUpNext, reasonsFor, upcomingFor } from '../lib/up-next-service'

// The Up Next page: rows per show with each source's own progress, and each source's fetch status. Caught-up
// rows also say when their next episode airs (#62); differing rows, the likely reasons (#78);
// anime whose next season is not on Simkl or MAL yet, whether it can be started there (#66); and how many
// links wait for your confirm on Mappings.
export default defineEventHandler(async () => {
  const { rows, errors, results, entries, store, lookups } = await loadUpNext()
  const sources = Object.fromEntries(Object.entries(results).map(([source, r]) => [source, { status: r.status, stale: r.stale, fetchedAt: r.fetchedAt, retryAfter: r.retryAfter, error: r.error }]))
  const reasons = await reasonsFor(rows)
  const withUpcoming = []
  for (const r of rows) withUpcoming.push({ ...r, upcoming: r.hasNext ? [] : await upcomingFor(r), reasons: reasons[r.key] ?? [], start: startable(r) })
  return { rows: withUpcoming, sources, errors, proposals: await proposalCount(entries, store, lookups) }
})
