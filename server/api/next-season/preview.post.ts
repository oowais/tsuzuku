import { z } from 'zod'
import { planStart, StartError } from '../../lib/next-season-service'
import { loadUpNext, loadUpNextCached } from '../../lib/up-next-service'

const body = z.object({ rowKey: z.string().min(1), malId: z.number().int().positive().optional() })

// What starting the next season would do, per source (#66). Writes nothing. Reads MAL's list status for the
// entry, so an entry already on your MAL list is never moved; the confirm reads it again.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const rows = loadUpNextCached() ?? (await loadUpNext()).rows
  try {
    return await planStart(rows, input.rowKey, input.malId)
  } catch (err) {
    if (err instanceof StartError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
})
