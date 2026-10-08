import { z } from 'zod'
import { useDb } from '../../db'
import { cachedEntries } from '../../lib/mapping-service'
import { createMappingStore } from '../../lib/mapping-store'

const body = z.object({ traktKey: z.string(), animeKey: z.string() })

// "Not this show": the pair is stored and never proposed again.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const entries = cachedEntries()
  const trakt = entries.find(e => e.key === input.traktKey && e.source === 'trakt')
  const anime = entries.find(e => e.key === input.animeKey && e.kind === 'anime')
  if (!trakt?.ids.trakt || !anime?.ids.mal) throw createError({ statusCode: 400, statusMessage: 'Unknown entry; reload the page' })
  createMappingStore(useDb()).reject(trakt.ids.trakt, anime.ids.mal)
  return { ok: true }
})
