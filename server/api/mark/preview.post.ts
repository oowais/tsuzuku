import { z } from 'zod'
import { useAdapters } from '../../adapters'
import { useDb } from '../../db'
import { MarkError, planMark } from '../../lib/mark-watched'
import { loadUpNext, loadUpNextCached } from '../../lib/up-next-service'
import { createWriteLog } from '../../lib/write-log'

// `signature`: the row as the page shows it, so a page loaded before a mark from another device is told the
// row has moved on (the preview plans from the server's lists, which that mark already updated).
const body = z.object({ rowKey: z.string().min(1), source: z.enum(['trakt', 'simkl', 'mal']).optional(), signature: z.string().optional() })

// What "mark next watched" would change, per source. Writes nothing. Planned from the lists the page already
// loaded, so it opens without calling a source; the confirm reads every source fresh before writing. Falls
// back to a fresh read when the lists were never fetched or the show is not in them.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  let row = loadUpNextCached()?.find(r => r.key === input.rowKey)
  if (!row) row = (await loadUpNext()).rows.find(r => r.key === input.rowKey)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'This show is no longer on Progress; reload the page' })
  try {
    const plan = planMark(row, input.source)
    // Trakt's up next carries no score: read the show's current one, only when a finale offers to change it.
    const trakt = plan.steps.find(s => s.source === 'trakt' && s.rating)
    if (trakt?.write.source === 'trakt') {
      const current = await useAdapters().trakt.showRating(trakt.write.show)
      trakt.rating = { scope: 'show', current: current.rating, unknown: !!current.error }
    }
    // Moved on since the page loaded: say so, with the last mark from Tsuzuku when there is one (it may also have
    // been watched on the source's own site or app).
    const changed = input.signature !== undefined && input.signature !== row.signature
    return { ...plan, changed: changed ? { lastMark: createWriteLog(useDb()).lastMark(row.key) } : null }
  } catch (err) {
    if (err instanceof MarkError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
})
