import { z } from 'zod'
import { MarkError, planMark } from '../../lib/mark-watched'
import { loadUpNext } from '../../lib/up-next-service'

const body = z.object({ rowKey: z.string().min(1), source: z.enum(['trakt', 'simkl', 'mal']).optional() })

// What "mark next watched" would change, per source, read fresh from the sources. Writes nothing.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const { rows } = await loadUpNext()
  const row = rows.find(r => r.key === input.rowKey)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'This show is no longer on Up Next; reload the page' })
  try {
    return planMark(row, input.source)
  } catch (err) {
    if (err instanceof MarkError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
})
