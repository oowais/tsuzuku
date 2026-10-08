// One common shape for an item on a source's watching list, built from the raw responses that
// GET /api/sources/watching returns. Field names are the ones seen in real responses (docs/context.md).
// Each entry keeps that source's own title, progress and next episode; nothing is merged across sources.

export type ListSource = 'trakt' | 'simkl' | 'mal'

export interface EntryIds {
  trakt?: number
  traktSlug?: string
  simkl?: number
  mal?: number
  anilist?: number
  tmdb?: number
  tvdb?: number
  imdb?: string
}

export interface NextEpisode {
  // Null when the source numbers episodes without seasons (Simkl anime, MAL).
  season: number | null
  number: number
  title: string | null
}

export interface Entry {
  source: ListSource
  // `${source}:${id}`, unique across sources.
  key: string
  // The list the item came from. Trakt has no anime flag, so every Trakt entry is a show.
  kind: 'show' | 'anime'
  // Source's own type: Simkl `anime_type`, MAL `media_type` (tv, ona, ova, movie, special, ...). Null when not given.
  format: string | null
  title: string
  altTitles: string[]
  year: number | null
  ids: EntryIds
  watched: number
  // Episode count as the source reports it: Trakt aired, Simkl aired (total minus not aired),
  // MAL planned total. Null when unknown.
  episodes: number | null
  next: NextEpisode | null
  // When the user last watched (Trakt, Simkl) or last updated the list entry (MAL).
  lastActivityAt: string | null
}

type Json = Record<string, unknown>

const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
// Simkl sends most external IDs as strings, Trakt as numbers.
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined
}

function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

export function traktEntry(raw: unknown): Entry {
  const item = obj(raw)
  const show = obj(item.show)
  const ids = obj(show.ids)
  const progress = obj(item.progress)
  const next = obj(progress.next_episode)
  const trakt = num(ids.trakt)
  if (!trakt) throw new Error('Trakt item without show.ids.trakt')
  return {
    source: 'trakt',
    key: `trakt:${trakt}`,
    kind: 'show',
    format: null,
    title: str(show.title) ?? '',
    altTitles: [str(show.original_title)].filter((t): t is string => !!t && t !== show.title),
    year: num(show.year) ?? null,
    ids: compact({ trakt, traktSlug: str(ids.slug), tmdb: num(ids.tmdb), tvdb: num(ids.tvdb), imdb: str(ids.imdb) }),
    watched: num(progress.completed) ?? 0,
    episodes: num(progress.aired) ?? null,
    next: num(next.number) ? { season: typeof next.season === 'number' ? next.season : null, number: num(next.number)!, title: str(next.title) ?? null } : null,
    lastActivityAt: str(progress.last_watched_at) ?? null
  }
}

// Simkl writes the next episode as `S01E05` for shows and `E12` for anime.
export function parseSimklEpisode(value: unknown): { season: number | null, number: number } | null {
  const match = typeof value === 'string' ? /^(?:S(\d+))?E(\d+)$/.exec(value) : null
  return match ? { season: match[1] ? Number(match[1]) : null, number: Number(match[2]) } : null
}

export function simklEntry(raw: unknown, kind: 'show' | 'anime'): Entry {
  const item = obj(raw)
  const show = obj(item.show)
  const ids = obj(show.ids)
  const simkl = num(ids.simkl)
  if (!simkl) throw new Error('Simkl item without show.ids.simkl')
  const next = parseSimklEpisode(item.next_to_watch)
  const total = num(item.total_episodes_count)
  const notAired = typeof item.not_aired_episodes_count === 'number' ? item.not_aired_episodes_count : 0
  return {
    source: 'simkl',
    key: `simkl:${simkl}`,
    kind,
    format: str(item.anime_type) ?? null,
    title: str(show.title) ?? '',
    altTitles: [],
    year: num(show.year) ?? null,
    ids: compact({
      simkl,
      traktSlug: str(ids.traktslug),
      mal: num(ids.mal),
      anilist: num(ids.anilist),
      tmdb: num(ids.tmdb),
      tvdb: num(ids.tvdb),
      imdb: str(ids.imdb)
    }),
    watched: num(item.watched_episodes_count) ?? 0,
    episodes: total === undefined ? null : Math.max(0, total - notAired),
    next: next ? { ...next, title: str(obj(item.next_to_watch_info).title) ?? null } : null,
    lastActivityAt: str(item.last_watched_at) ?? null
  }
}

export function malEntry(raw: unknown): Entry {
  const item = obj(raw)
  const node = obj(item.node)
  const list = obj(item.list_status)
  const alt = obj(node.alternative_titles)
  const mal = num(node.id)
  if (!mal) throw new Error('MAL item without node.id')
  const watched = num(list.num_episodes_watched) ?? 0
  // MAL reports 0 episodes when the total is not known yet.
  const episodes = num(node.num_episodes) ?? null
  const startYear = num(obj(node.start_season).year) ?? num(str(node.start_date)?.slice(0, 4))
  const title = str(node.title) ?? ''
  const altTitles = [str(alt.en), str(alt.ja), ...(Array.isArray(alt.synonyms) ? alt.synonyms.map(str) : [])]
    .filter((t): t is string => !!t && t !== title)
  return {
    source: 'mal',
    key: `mal:${mal}`,
    kind: 'anime',
    format: str(node.media_type) ?? null,
    title,
    altTitles,
    year: startYear ?? null,
    ids: { mal },
    watched,
    episodes,
    // MAL gives a count, not episodes: the next one is watched + 1. Whether it has aired is unknown here.
    next: episodes === null || watched < episodes ? { season: null, number: watched + 1, title: null } : null,
    lastActivityAt: str(list.updated_at) ?? null
  }
}

export interface WatchingLists {
  trakt?: unknown[] | null
  simkl?: { shows?: unknown[], anime?: unknown[] } | null
  mal?: { data?: unknown[] } | null
}

// An item that cannot be read is reported and skipped, so one odd item never hides the rest of the list.
export function entriesFrom(lists: WatchingLists): { entries: Entry[], errors: { source: ListSource, error: string }[] } {
  const entries: Entry[] = []
  const errors: { source: ListSource, error: string }[] = []
  const add = (source: ListSource, items: unknown[] | undefined, read: (raw: unknown) => Entry) => {
    for (const raw of items ?? []) {
      try {
        entries.push(read(raw))
      } catch (err) {
        errors.push({ source, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  add('trakt', lists.trakt ?? undefined, traktEntry)
  add('simkl', lists.simkl?.shows, raw => simklEntry(raw, 'show'))
  add('simkl', lists.simkl?.anime, raw => simklEntry(raw, 'anime'))
  add('mal', lists.mal?.data, malEntry)
  return { entries, errors }
}
