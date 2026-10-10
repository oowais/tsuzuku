import { z } from 'zod'
import { useAdapters } from '../adapters'
import { RECENT_PLAYS_KEY } from '../adapters/trakt'
import { useDb } from '../db'
import { summarize, writeStats, type StatsSource } from '../lib/stats'
import { useSourceWrapper } from '../lib/source-wrapper'
import { createWriteLog } from '../lib/write-log'

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
    // Trakt counts kept from before the history figures (#61) are read again rather than kept for 12 hours.
    const outdated = source === 'trakt' && !(wrapper.readCache(source, 'stats') as { history?: unknown } | undefined)?.history
    if (refresh !== '1' && at && !outdated && Date.now() - at.getTime() < KEEP_MS) {
      return summarize(source, { source, status: 'ok', data: wrapper.readCache(source, 'stats'), fetchedAt: at, retryAfter: null, stale: false })
    }
    return summarize(source, await adapters[source].fetchStats())
  }

  // One after another: Simkl's call is heavy, and nothing here needs speed.
  const sources = []
  for (const source of ['trakt', 'simkl', 'mal'] as const) sources.push(await load(source))

  // The last 32 days of Trakt history (#61), kept like the stats but read again once Trakt took a mark from
  // Tsuzuku after it was kept: one call, so this week and this month follow your marks.
  const history = sources[0]!.history
  if (history) {
    const at = wrapper.cachedAt('trakt', RECENT_PLAYS_KEY)
    const marked = createWriteLog(useDb()).lastSuccessAt('trakt')
    const keep = refresh !== '1' && at && Date.now() - at.getTime() < KEEP_MS && !(marked && marked > at)
    history.recent = keep ? wrapper.readCache('trakt', RECENT_PLAYS_KEY) as string[] : (await adapters.trakt.recentPlays()).data
  }
  return { sources, writes: writeStats(useDb()) }
})
