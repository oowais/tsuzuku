import { z } from 'zod'
import { useAdapters } from '../adapters'
import { loadCalendar } from '../lib/calendar-service'
import { loadUpNext, loadUpNextCached } from '../lib/up-next-service'

const DAY = 24 * 60 * 60 * 1000
const query = z.object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine(q => q.to > q.from && q.to.getTime() - q.from.getTime() <= 32 * DAY, 'A range of at most 32 days')

// The calendar for a range, one month in your own time zone (#72). Up Next as last read, so opening the
// calendar does not read the three lists again.
export default defineEventHandler(async (event) => {
  const { from, to } = await getValidatedQuery(event, query.parse)
  const rows = loadUpNextCached() ?? (await loadUpNext()).rows
  return loadCalendar(rows, from, to, Date.now(), useAdapters())
})
