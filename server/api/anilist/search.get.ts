import { z } from 'zod'
import { useAdapters } from '../../adapters'
import { targetOf } from '../../lib/next-season'

const query = z.object({ q: z.string().trim().min(2).max(200) })

// Anime by title on AniList, to pick the entry for a show nothing links yet (#66). Real results only.
export default defineEventHandler(async (event) => {
  const { q } = query.parse(getQuery(event))
  const res = await useAdapters().anilist.search(q)
  if (res.status !== 'ok') throw createError({ statusCode: 502, statusMessage: res.error ?? `AniList: ${res.status}` })
  return res.media.map(targetOf)
})
