import { z } from 'zod'
import { useAdapters } from '../../adapters'

const query = z.object({ q: z.string().trim().min(1).max(200) })

// Trakt shows matching a title, or the show behind a pasted trakt.tv link. Read-only.
export default defineEventHandler(async (event) => {
  const { q } = await getValidatedQuery(event, query.parse)
  return useAdapters().traktPublic.search(q)
})
