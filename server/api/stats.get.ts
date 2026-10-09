import { z } from 'zod'
import { useAdapters } from '../adapters'
import { useDb } from '../db'
import { summarize, writeStats, type StatsSource } from '../lib/stats'
import { useSourceWrapper } from '../lib/source-wrapper'

// Each source's stats are kept for this long; Refresh (`?refresh=1`) asks again. Simkl asks that its stats,
// computed live from the whole history, are only fetched on an explicit user action.
const KEEP_MS = 12 * 60 * 60 * 1000

const query = z.object({ refresh: z.enum(['0', '1']).optional() })

export default defineEventHandler(async (event) => {
  const { refresh } = query.parse(getQuery(event))
  const wrapper = useSourceWrapper()
  const adapters = useAdapters()

  const load = async (source: StatsSource) => {
    const at = wrapper.cachedAt(source, 'stats')
    if (refresh !== '1' && at && Date.now() - at.getTime() < KEEP_MS) {
      return summarize(source, { source, status: 'ok', data: wrapper.readCache(source, 'stats'), fetchedAt: at, retryAfter: null, stale: false })
    }
    return summarize(source, await adapters[source].fetchStats())
  }

  // One after another: Simkl's call is heavy, and nothing here needs speed.
  const sources = []
  for (const source of ['trakt', 'simkl', 'mal'] as const) sources.push(await load(source))
  return { sources, writes: writeStats(useDb()) }
})
