import { episodeUrl } from '../../shared/utils/source-links'
import type { AiringEpisode, AniListMedia } from '../adapters/anilist'
import type { Entry } from './entries'
import type { Row } from './up-next'

// The calendar (#72): what airs in a range, per source, never merged (decision #19). Each item is one
// source's own episode with its own title, number and date, linking to that source's page (decision #24).
// When two sources give the same episode different dates, both show. Read-only: no mark button.

export type CalendarSource = 'trakt' | 'anilist' | 'simkl'

export interface CalendarItem {
  source: CalendarSource
  // Groups one show's items across sources: the Up Next row key, or the source's own key off Up Next.
  group: string
  title: string
  episode: string
  episodeTitle: string | null
  // An instant (ISO), or for a date-only source the calendar date as the source wrote it (YYYY-MM-DD).
  airsAt: string
  dateOnly: boolean
  url: string | null
  // You have watched it on that source's side (Trakt: before up next's next episode; anime: within your
  // MAL count, else Simkl's). Unknown counts as not watched.
  watched: boolean
  onUpNext: boolean
}

export interface CalendarInput {
  rows: Row[]
  // Raw Trakt calendar items.
  trakt: unknown[]
  // AniList media by MAL ID, for the anime on Up Next, and their episodes in the range.
  anilist: Record<number, AniListMedia | null>
  airing: AiringEpisode[]
  from: Date
  to: Date
  now: number
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {})
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

const before = (a: { season: number, number: number }, b: { season: number | null, number: number }) =>
  a.season < (b.season ?? 0) || (a.season === (b.season ?? 0) && a.number < b.number)

export function buildCalendar(input: CalendarInput): CalendarItem[] {
  const { rows, from, to, now } = input
  const inRange = (t: number) => t >= from.getTime() && t < to.getTime()
  const items: CalendarItem[] = []

  // Trakt: every show on your Trakt calendar. Caught-up shows are off Trakt's up next (decision #22), and they
  // are the ones airing, so the calendar is not cut down to Up Next.
  const rowByTrakt = new Map<number | string, { row: Row, entry: Entry | null }>()
  for (const row of rows) {
    const cell = row.cells.trakt
    const entry = cell?.entry ?? null
    const id = entry?.ids.trakt
    const slug = entry?.ids.traktSlug ?? cell?.ref?.traktSlug
    if (id) rowByTrakt.set(id, { row, entry })
    if (slug) rowByTrakt.set(slug, { row, entry })
  }
  for (const raw of input.trakt) {
    const item = obj(raw)
    const show = obj(item.show)
    const ids = obj(show.ids)
    const ep = obj(item.episode)
    const id = num(ids.trakt)
    const slug = str(ids.slug)
    const season = num(ep.season)
    const number = num(ep.number)
    const airsAt = str(item.first_aired)
    if (!id || season === undefined || number === undefined || !airsAt || !inRange(Date.parse(airsAt))) continue
    const match = rowByTrakt.get(id) ?? (slug ? rowByTrakt.get(slug) : undefined)
    const next = match?.entry?.next
    // On up next: watched when before its next episode. Caught up there (no next): everything aired is watched.
    const watched = match?.entry ? (next ? before({ season, number }, next) : Date.parse(airsAt) <= now) : false
    items.push({
      source: 'trakt',
      group: match?.row.key ?? `trakt:${id}`,
      title: str(show.title) ?? '',
      episode: `S${season}E${number}`,
      episodeTitle: str(ep.title) ?? null,
      airsAt,
      dateOnly: false,
      url: slug ? episodeUrl({ source: 'trakt', kind: 'show', ids: { traktSlug: slug } }, { season, number }) : null,
      watched,
      onUpNext: !!match
    })
  }

  // AniList: the anime entries on Up Next (Simkl and MAL keep caught-up anime on watching).
  const byMedia = new Map<number, { row: Row, media: AniListMedia, watched: number | null }>()
  for (const row of rows) {
    const mal = row.cells.mal?.entry
    const simkl = row.cells.simkl?.entry
    for (const entry of [mal, simkl]) {
      const malId = entry?.ids.mal
      const media = malId ? input.anilist[malId] : null
      if (!media || byMedia.has(media.id)) continue
      // Your count on MAL for this entry, else Simkl's.
      const count = mal?.ids.mal === malId ? mal!.watched : simkl?.ids.mal === malId ? simkl!.watched : null
      byMedia.set(media.id, { row, media, watched: count })
    }
  }
  for (const a of input.airing) {
    const hit = byMedia.get(a.mediaId)
    const at = a.airingAt * 1000
    if (!hit || !inRange(at)) continue
    const t = obj(hit.media.title)
    items.push({
      source: 'anilist',
      group: hit.row.key,
      title: str(t.english) ?? str(t.romaji) ?? hit.row.title,
      episode: `E${a.episode}`,
      episodeTitle: null,
      airsAt: new Date(at).toISOString(),
      dateOnly: false,
      url: `https://anilist.co/anime/${hit.media.id}`,
      watched: hit.watched !== null && a.episode <= hit.watched,
      onUpNext: true
    })
  }

  // Simkl: the date it gives your next episode to watch. For anime that is midnight in Japan, a calendar date,
  // so it is kept as written (like Up Next) and placed on that date.
  for (const row of rows) {
    const e = row.cells.simkl?.entry
    const date = e?.next?.airedAt?.slice(0, 10)
    if (!e?.next || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    // A date is in range when its day overlaps the range.
    const day = Date.parse(`${date}T00:00:00Z`)
    if (day + 24 * 60 * 60 * 1000 <= from.getTime() || day >= to.getTime() + 24 * 60 * 60 * 1000) continue
    items.push({
      source: 'simkl',
      group: row.key,
      title: e.title,
      episode: e.next.season != null ? `S${e.next.season}E${e.next.number}` : `E${e.next.number}`,
      episodeTitle: e.next.title,
      airsAt: date,
      dateOnly: true,
      url: episodeUrl({ source: 'simkl', kind: e.kind, ids: { simkl: e.ids.simkl, simklSlug: e.ids.simklSlug } }, e.next),
      watched: false,
      onUpNext: true
    })
  }

  return items.sort((a, b) => a.airsAt.localeCompare(b.airsAt) || a.group.localeCompare(b.group) || a.source.localeCompare(b.source))
}
