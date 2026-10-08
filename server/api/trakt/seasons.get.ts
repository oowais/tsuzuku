import { z } from 'zod'
import { useAdapters } from '../../adapters'

const query = z.object({ show: z.coerce.number().int().positive() })

// A Trakt show's seasons with episode counts, for picking where an anime entry goes. Read-only, cached.
export default defineEventHandler(async (event) => {
  const { show } = await getValidatedQuery(event, query.parse)
  return useAdapters().traktPublic.seasons(show)
})
