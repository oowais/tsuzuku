import { z } from 'zod'
import { useDb } from '../../db'
import { createMappingStore, MappingError } from '../../lib/mapping-store'

const body = z.object({
  seasonId: z.number().int().positive(),
  traktSeason: z.number().int().min(0),
  episodeOffset: z.number().int()
})

// Changes where a linked anime entry sits in its Trakt show (local database only).
export default defineEventHandler(async (event) => {
  const { seasonId, ...place } = body.parse(await readBody(event))
  try {
    createMappingStore(useDb()).editSeason(seasonId, place)
  } catch (err) {
    if (err instanceof MappingError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
  return { ok: true }
})
