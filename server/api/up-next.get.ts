import { loadUpNext, upcomingFor } from '../lib/up-next-service'

// The Up Next page: rows per show with each source's own progress, and each source's fetch status. Caught-up
// rows also say when their next episode airs (#62).
export default defineEventHandler(async () => {
  const { rows, errors, results } = await loadUpNext()
  const sources = Object.fromEntries(Object.entries(results).map(([source, r]) => [source, { status: r.status, stale: r.stale, fetchedAt: r.fetchedAt, retryAfter: r.retryAfter, error: r.error }]))
  const withUpcoming = []
  for (const r of rows) withUpcoming.push({ ...r, upcoming: r.hasNext ? [] : await upcomingFor(r) })
  return { rows: withUpcoming, sources, errors }
})
