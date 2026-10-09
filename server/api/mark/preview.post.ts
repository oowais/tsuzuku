import { z } from 'zod'
import { useAdapters } from '../../adapters'
import { MarkError, planMark } from '../../lib/mark-watched'
import { loadUpNext, loadUpNextCached } from '../../lib/up-next-service'

const body = z.object({ rowKey: z.string().min(1), source: z.enum(['trakt', 'simkl', 'mal']).optional() })

// What "mark next watched" would change, per source. Writes nothing. Planned from the lists the page already
// loaded, so it opens without calling a source; the confirm reads every source fresh before writing. Falls
// back to a fresh read when the lists were never fetched or the show is not in them.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  let row = loadUpNextCached()?.find(r => r.key === input.rowKey)
  if (!row) row = (await loadUpNext()).rows.find(r => r.key === input.rowKey)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'This show is no longer on Up Next; reload the page' })
  try {
    const plan = planMark(row, input.source)
    // Trakt's up next carries no score: read the show's current one, only when a finale offers to change it.
    const trakt = plan.steps.find(s => s.source === 'trakt' && s.rating)
    if (trakt?.write.source === 'trakt') {
      const current = await useAdapters().trakt.showRating(trakt.write.show)
      trakt.rating = { scope: 'show', current: current.rating, unknown: !!current.error }
    }
    return plan
  } catch (err) {
    if (err instanceof MarkError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
})
