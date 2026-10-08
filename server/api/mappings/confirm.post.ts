import { z } from 'zod'
import { useDb } from '../../db'
import { cachedEntries } from '../../lib/mapping-service'
import { createMappingStore, MappingError } from '../../lib/mapping-store'

const body = z.object({
  traktKey: z.string(),
  animeKey: z.string(),
  traktSeason: z.number().int().min(0),
  episodeOffset: z.number().int()
})

// Places an anime entry in a Trakt season. Both keys must be entries on your current lists, so only
// real IDs are ever stored.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const entries = cachedEntries()
  const trakt = entries.find(e => e.key === input.traktKey && e.source === 'trakt')
  const anime = entries.find(e => e.key === input.animeKey && e.kind === 'anime')
  if (!trakt || !anime) throw createError({ statusCode: 400, statusMessage: 'Unknown entry; reload the page' })

  try {
    createMappingStore(useDb()).confirm(trakt, anime, input)
  } catch (err) {
    if (err instanceof MappingError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
  return { ok: true }
})
