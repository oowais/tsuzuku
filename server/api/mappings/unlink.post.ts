import { z } from 'zod'
import { useDb } from '../../db'
import { createMappingStore, MappingError } from '../../lib/mapping-store'

// An anime entry by its season row, or a show-level link by its mapping.
const body = z.union([
  z.object({ seasonId: z.number().int().positive() }),
  z.object({ mappingId: z.number().int().positive(), restore: z.boolean().optional() })
])

// Removes a link (or restores a show link you removed). Local database only; the pair is remembered so
// an automatic match does not quietly bring it back.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const store = createMappingStore(useDb())
  try {
    if ('seasonId' in input) store.unlinkSeason(input.seasonId)
    else store.setShowLinked(input.mappingId, input.restore === true)
  } catch (err) {
    if (err instanceof MappingError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
  return { ok: true }
})
