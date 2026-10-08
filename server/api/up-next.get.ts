import { loadUpNext } from '../lib/up-next-service'

// The Up Next page: rows per show with each source's own progress, and each source's fetch status.
export default defineEventHandler(async () => {
  const { rows, errors, results } = await loadUpNext()
  const sources = Object.fromEntries(Object.entries(results).map(([source, r]) => [source, { status: r.status, stale: r.stale, fetchedAt: r.fetchedAt, retryAfter: r.retryAfter, error: r.error }]))
  return { rows, sources, errors }
})
