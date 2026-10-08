import type { mappings, mappingSeasons } from '../db/schema'
import type { Entry, ListSource, NextEpisode } from './entries'

// The Up Next view (step 5): one row per show, one cell per source, each with that source's own title,
// progress and next episode (decision #19). Nothing is computed across sources: a row only compares the
// sources' own next episodes, exactly (decision #10), and flags any difference without picking a winner.

type Mapping = typeof mappings.$inferSelect & { seasons: (typeof mappingSeasons.$inferSelect)[] }

export type CellState
  = | 'in_sync' // agrees with every other source that has a position
    | 'differs' // disagrees with at least one other source
    | 'caught_up' // on the list, no next episode
    | 'not_in_list' // linked, but not on this source's watching list now
    | 'unmapped' // no link to this source
    | 'not_placed' // linked anime entry not placed in a Trakt season yet, so not comparable
    | 'alone' // the only source with this show, so there is nothing to compare with

export interface Cell {
  source: ListSource
  state: CellState
  // The source's own list entry, when it is on the list.
  entry: Entry | null
  // For a linked show that is not on the list: what to link to.
  ref: { title: string, traktSlug?: string, simkl?: number, mal?: number } | null
  // The next episode in Trakt's numbering, when a confirmed placement allows it (anime only).
  traktNext: NextEpisode | null
  // Source-level flags from the fetch.
  stale: boolean
  blocked: boolean
}

export interface Row {
  key: string
  section: 'trakt' | 'other'
  kind: 'show' | 'anime' | 'unknown'
  title: string
  cells: Partial<Record<ListSource, Cell>>
  differs: boolean
  // What the sources said, for the ignore list: compared positions per source.
  signature: string
  hasNext: boolean
  lastActivityAt: string | null
  // Posters for where you are in the show, most season-specific first. The page falls back to the next
  // one when an image does not load.
  images: string[]
}

export interface SourceFlags {
  stale: boolean
  blocked: boolean
}

export interface UpNextInput {
  entries: Entry[]
  mappings: Mapping[]
  traktTitles: Record<number, string>
  flags: Record<ListSource, SourceFlags>
  // Trakt season posters by show and season number, from the cached season lookups.
  traktSeasonPosters?: Record<number, Record<number, string>>
}

// A position to compare: Trakt season and episode, or the entry's own episode when there is no Trakt side.
const position = (next: NextEpisode | null) => (next ? `${next.season ?? ''}x${next.number}` : 'caught_up')

export function buildUpNext(input: UpNextInput): Row[] {
  const { entries, flags } = input
  const listed = (source: ListSource) => entries.filter(e => e.source === source)
  const traktById = new Map(listed('trakt').map(e => [e.ids.trakt!, e]))
  const used = new Set<string>()

  const cell = (source: ListSource, state: CellState, extra: Partial<Cell> = {}): Cell => ({
    source, state, entry: null, ref: null, traktNext: null, ...flags[source], ...extra
  })

  // Every source that has a position takes part in the comparison; caught up counts as a position.
  // Anime: the entry you are on (MAL, else Simkl) is already one season. Shows: Trakt's poster for the
  // season you are on, else the show's.
  function pickImages(row: Omit<Row, 'differs' | 'signature' | 'hasNext' | 'lastActivityAt' | 'images'>): string[] {
    const t = row.cells.trakt?.entry
    const traktSeason = t?.next?.season != null ? input.traktSeasonPosters?.[t.ids.trakt!]?.[t.next.season] ?? null : null
    const fromEntries = [row.cells.mal?.entry?.image, row.cells.simkl?.entry?.image]
    const ordered = row.kind === 'anime'
      ? [...fromEntries, traktSeason, t?.image]
      : [traktSeason, t?.image, ...fromEntries]
    return [...new Set(ordered.filter((u): u is string => !!u))]
  }

  function compare(row: Omit<Row, 'differs' | 'signature' | 'hasNext' | 'lastActivityAt' | 'images'>): Row {
    const comparable = Object.values(row.cells).filter((c): c is Cell => !!c?.entry && c.state !== 'not_placed')
    const positions = comparable.map(c => [c.source, position(c.entry!.source === 'trakt' || row.kind === 'show' ? c.entry!.next : c.traktNext ?? c.entry!.next)] as const)
    const differs = new Set(positions.map(([, p]) => p)).size > 1
    for (const c of comparable) {
      if (differs) c.state = 'differs'
      else if (c.entry!.next === null) c.state = 'caught_up'
      else c.state = comparable.length > 1 ? 'in_sync' : 'alone'
    }
    const activity = comparable.map(c => c.entry!.lastActivityAt).filter((t): t is string => !!t).sort().at(-1) ?? null
    return {
      ...row,
      differs,
      signature: positions.map(([s, p]) => `${s}:${p}`).sort().join('|'),
      hasNext: comparable.some(c => c.entry!.next !== null),
      lastActivityAt: activity,
      images: pickImages(row)
    }
  }

  // The listed Simkl and MAL entries of an anime season row.
  const animeEntries = (s: Mapping['seasons'][number]) => entries.filter(e => e.kind === 'anime'
    && ((s.malId !== null && e.ids.mal === s.malId) || (s.simklId !== null && e.ids.simkl === s.simklId)))

  function animeCell(source: 'simkl' | 'mal', m: Mapping, trakt: Entry | undefined): Cell {
    // The source's listed entries for this show, the one in Trakt's current season first.
    const candidates = m.seasons.flatMap(s => animeEntries(s).filter(e => e.source === source).map(e => ({ e, s })))
    const current = candidates.find(c => trakt?.next && c.s.traktSeason === trakt.next.season) ?? candidates[0]
    if (!current) {
      const stored = m.seasons.find(s => (source === 'mal' ? s.malId : s.simklId) !== null)
      if (!stored) return cell(source, 'unmapped')
      return cell(source, 'not_in_list', { ref: { title: '', ...(source === 'mal' ? { mal: stored.malId! } : { simkl: stored.simklId! }) } })
    }
    used.add(current.e.key)
    if (current.s.traktSeason === null || m.traktId === null) return cell(source, 'not_placed', { entry: current.e })
    const next = current.e.next
    return cell(source, 'in_sync', {
      entry: current.e,
      traktNext: next ? { season: current.s.traktSeason, number: next.number + current.s.episodeOffset, title: next.title } : null
    })
  }

  const rows: Row[] = []

  // 1. Trakt up next, in Trakt's order.
  for (const t of listed('trakt')) {
    used.add(t.key)
    const m = input.mappings.find(x => x.traktId === t.ids.trakt && x.status !== 'rejected')
    const traktCell = cell('trakt', 'in_sync', { entry: t })
    if (!m) {
      rows.push(compare({ key: `t:${t.ids.trakt}`, section: 'trakt', kind: 'unknown', title: t.title, cells: { trakt: traktCell, simkl: cell('simkl', 'unmapped'), mal: cell('mal', 'unmapped') } }))
      continue
    }
    if (m.kind === 'show') {
      const simkl = listed('simkl').find(e => e.ids.simkl === m.simklId)
      if (simkl) used.add(simkl.key)
      rows.push(compare({
        key: `m:${m.id}`, section: 'trakt', kind: 'show', title: t.title,
        cells: { trakt: traktCell, simkl: simkl ? cell('simkl', 'in_sync', { entry: simkl }) : cell('simkl', m.simklId ? 'not_in_list' : 'unmapped', { ref: m.simklId ? { title: '', simkl: m.simklId } : null }) }
      }))
      continue
    }
    rows.push(compare({
      key: `m:${m.id}`, section: 'trakt', kind: 'anime', title: t.title,
      cells: { trakt: traktCell, simkl: animeCell('simkl', m, t), mal: animeCell('mal', m, t) }
    }))
  }

  // 2. Everything else on Simkl or MAL: linked shows Trakt does not list as up next, and unlinked entries.
  const other: Row[] = []
  for (const m of input.mappings) {
    if (m.status === 'rejected' || (m.traktId !== null && traktById.has(m.traktId))) continue
    const traktRef = m.traktId !== null ? { title: input.traktTitles[m.traktId] ?? m.traktSlug ?? `Trakt #${m.traktId}`, traktSlug: m.traktSlug ?? undefined } : null
    const traktCell = traktRef ? cell('trakt', 'not_in_list', { ref: traktRef }) : cell('trakt', 'unmapped')
    if (m.kind === 'show') {
      const simkl = listed('simkl').find(e => e.ids.simkl === m.simklId)
      if (!simkl) continue
      used.add(simkl.key)
      other.push(compare({ key: `m:${m.id}`, section: 'other', kind: 'show', title: simkl.title, cells: { trakt: traktCell, simkl: cell('simkl', 'in_sync', { entry: simkl }) } }))
      continue
    }
    const simkl = animeCell('simkl', m, undefined)
    const mal = animeCell('mal', m, undefined)
    if (!simkl.entry && !mal.entry) continue
    // Without a Trakt show on the list, Simkl and MAL compare in the entry's own numbering.
    for (const c of [simkl, mal]) if (c.state === 'not_placed') c.state = 'in_sync'
    other.push(compare({ key: `m:${m.id}`, section: 'other', kind: 'anime', title: (mal.entry ?? simkl.entry)!.title, cells: { trakt: traktCell, simkl, mal } }))
  }

  // Entries on no mapping at all (for example a single-source entry nothing links yet).
  for (const e of entries) {
    if (e.source === 'trakt' || used.has(e.key)) continue
    used.add(e.key)
    const own = cell(e.source, 'in_sync', { entry: e })
    other.push(compare({
      key: `e:${e.key}`, section: 'other', kind: e.kind, title: e.title,
      cells: { trakt: cell('trakt', 'unmapped'), [e.source]: own, ...(e.kind === 'anime' ? { [e.source === 'mal' ? 'simkl' : 'mal']: cell(e.source === 'mal' ? 'simkl' : 'mal', 'unmapped') } : {}) }
    }))
  }

  // Something to watch first, then caught up; each by its own last activity, newest first.
  other.sort((a, b) => Number(b.hasNext) - Number(a.hasNext) || (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
  return [...rows, ...other]
}
