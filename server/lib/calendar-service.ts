import type { createAniListAdapter } from '../adapters/anilist'
import { CALENDAR_MAX_DAYS, type createTraktAdapter } from '../adapters/trakt'
import { buildCalendar } from './calendar'
import type { Row } from './up-next'

const DAY = 24 * 60 * 60 * 1000

interface Sources {
  trakt: Pick<ReturnType<typeof createTraktAdapter>, 'calendar' | 'watchedBetween'>
  anilist: Pick<ReturnType<typeof createAniListAdapter>, 'byMalIds' | 'airingSchedule'>
}

// The calendar for a range (#72): one Trakt call and one AniList call (a page per 50 episodes), each cached
// a few hours, plus the AniList lookups for the anime on Up Next (mostly cached already).
// Your Trakt history since the range began fades what you watched; it is read again after a Trakt write.
export async function loadCalendar(rows: Row[], from: Date, to: Date, now: number, { trakt, anilist }: Sources, lastTraktWrite: Date | null = null) {
  // Trakt counts days from a UTC date.
  const start = from.toISOString().slice(0, 10)
  const days = Math.min(CALENDAR_MAX_DAYS, Math.ceil((to.getTime() - Date.parse(`${start}T00:00:00Z`)) / DAY))
  const traktRes = await trakt.calendar(start, days)
  // Nothing in a range that has not begun can have been watched.
  const history = from.getTime() < now ? await trakt.watchedBetween(from, new Date(Math.min(to.getTime(), now)), lastTraktWrite) : null
  const traktWatched = history === null ? new Set<string>() : history.data && !history.stale ? new Set(history.data.map(w => `${w.show}:${w.season}:${w.number}`)) : null

  const malIds = rows.flatMap(r => [r.cells.mal?.entry?.ids.mal, r.cells.simkl?.entry?.ids.mal])
    .filter((id): id is number => typeof id === 'number')
  const lookup = await anilist.byMalIds(malIds)
  const anilistIds = Object.values(lookup.media).flatMap(m => (m ? [m.id] : []))
  const airing = await anilist.airingSchedule(anilistIds, Math.floor(from.getTime() / 1000) - 1, Math.ceil(to.getTime() / 1000))

  const status = (r: { status: string, stale?: boolean, error?: string, retryAfter: number | null }) =>
    ({ status: r.status, stale: !!r.stale, error: r.error ?? null, retryAfter: r.retryAfter })
  return {
    items: buildCalendar({ rows, trakt: traktRes.data ?? [], anilist: lookup.media, airing: airing.data ?? [], traktWatched, from, to, now }),
    sources: { trakt: status(traktRes), anilist: status(airing.status !== 'ok' ? airing : lookup) }
  }
}
