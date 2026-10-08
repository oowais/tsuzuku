import { z } from 'zod'
import { useDb } from '../../db'
import { cachedEntries } from '../../lib/mapping-service'
import { createMappingStore } from '../../lib/mapping-store'

const body = z.object({ traktId: z.number().int().positive(), animeKey: z.string() })

// "Not this show": the pair is stored and never proposed again.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const anime = cachedEntries().find(e => e.key === input.animeKey && e.kind === 'anime')
  if (!anime?.ids.mal) throw createError({ statusCode: 400, statusMessage: 'Unknown entry; reload the page' })
  createMappingStore(useDb()).reject(input.traktId, anime.ids.mal)
  return { ok: true }
})
