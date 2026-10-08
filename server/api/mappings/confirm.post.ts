import { z } from 'zod'
import { useDb } from '../../db'
import { cachedEntries, resolveTraktShow } from '../../lib/mapping-service'
import { createMappingStore, MappingError } from '../../lib/mapping-store'

const body = z.object({
  traktId: z.number().int().positive(),
  animeKey: z.string(),
  traktSeason: z.number().int().min(0),
  episodeOffset: z.number().int()
})

// Places an anime entry in a Trakt season. The anime entry must be on your current lists and the Trakt show
// must be on your up-next list or confirmed by Trakt, so only real IDs are ever stored.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const entries = cachedEntries()
  const anime = entries.find(e => e.key === input.animeKey && e.kind === 'anime')
  if (!anime) throw createError({ statusCode: 400, statusMessage: 'Unknown entry; reload the page' })
  const trakt = await resolveTraktShow(input.traktId, entries)
  if (!trakt) throw createError({ statusCode: 400, statusMessage: 'Trakt does not know this show' })

  try {
    createMappingStore(useDb()).confirm(trakt, anime, input)
  } catch (err) {
    if (err instanceof MappingError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
  return { ok: true }
})
