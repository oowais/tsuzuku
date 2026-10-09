import { z } from 'zod'
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
    return planMark(row, input.source)
  } catch (err) {
    if (err instanceof MarkError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
})
