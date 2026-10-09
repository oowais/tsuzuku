import type { DiffReason } from '../../shared/utils/diff-reasons'
import { episodeLabel } from '../../shared/utils/source-links'
import type { ListSource } from './entries'
import { plausibleOffsets, type ChainStep } from './seasons'
import type { Cell, Row } from './up-next'

// Why a row differs (#78): likely causes from what is already loaded (the row, its links, the write log,
// cached AniList chains), most specific first. Only hints: nothing here picks a "true" position or changes
// anything (decisions #2, #10); each cause points at the normal flow that fixes it, if any.
// Extension point for #16: a model may later choose among these candidates when several fit, never add one.

export type { DiffReason }

export interface LoggedWrite {
  source: string
  at: Date
  markId: string | null
  result: 'ok' | 'error'
}

export interface ReasonContext {
  // This row's mark writes, any order.
  writes: LoggedWrite[]
  // AniList season chains by MAL ID, from the cache.
  chains: Record<number, ChainStep[]>
  now: number
}

interface Point {
  cell: Cell
  season: number | null
  number: number
  // The source lists this episode as next (false: caught up, the point is the one after the last watched).
  listed: boolean
  airedAt: string | null
}

const MARK_WINDOW_MS = 60 * 1000

// A source's position in the row's common numbering: Trakt's for shows and placed anime, else the entry's own.
function pointOf(row: Row, c: Cell): Point | null {
  const e = c.entry
  if (!e) return null
  if (c.source === 'trakt' || row.kind === 'show') {
    return e.next ? { cell: c, season: e.next.season, number: e.next.number, listed: true, airedAt: e.next.airedAt ?? null } : null
  }
  const own = e.next?.number ?? e.watched + 1
  const p = c.placement
  const placed = !!row.cells.trakt?.entry && p && p.traktSeason !== null
  return { cell: c, season: placed ? p.traktSeason : null, number: own + (placed ? p.episodeOffset : 0), listed: !!e.next, airedAt: e.next?.airedAt ?? null }
}

// The latest mark of this row: the writes of one confirm (same markId), or for older entries the writes
// within a minute of the newest.
function lastMark(writes: LoggedWrite[]) {
  const sorted = [...writes].sort((a, b) => b.at.getTime() - a.at.getTime())
  const newest = sorted[0]
  if (!newest) return null
  const same = sorted.filter(w => newest.markId ? w.markId === newest.markId : !w.markId && newest.at.getTime() - w.at.getTime() <= MARK_WINDOW_MS)
  return { at: newest.at, ok: [...new Set(same.filter(w => w.result === 'ok').map(w => w.source as ListSource))] }
}

export function explainDifference(row: Row, ctx: ReasonContext): DiffReason[] {
  if (!row.differs) return []
  const points = (['trakt', 'simkl', 'mal'] as const).flatMap((s) => {
    const c = row.cells[s]
    const p = c && c.state === 'differs' ? pointOf(row, c) : null
    return p ? [p] : []
  })
  if (points.length < 2) return []
  const ref = points[0]!
  const reasons: DiffReason[] = []
  const explained = new Set<ListSource>()
  const sameSeason = (a: Point, b: Point) => a.season === b.season

  // 1. A mark that reached only some sources, leaving one exactly one episode behind.
  const mark = lastMark(ctx.writes)
  if (mark?.ok.length) {
    for (const behind of points.filter(p => !mark.ok.includes(p.cell.source))) {
      const reached = points.find(p => mark.ok.includes(p.cell.source) && sameSeason(p, behind) && p.number === behind.number + 1)
      if (!reached) continue
      reasons.push({ kind: 'partial_mark', at: mark.at.toISOString(), reached: mark.ok, behind: behind.cell.source })
      explained.add(behind.cell.source)
    }
  }

  // 2. Anime placed in a Trakt season: an offset the season chain allows, or an episode outside the entry.
  if (ref.cell.source === 'trakt') {
    for (const p of points.slice(1)) {
      const placement = p.cell.placement
      const entry = p.cell.entry!
      if (explained.has(p.cell.source) || !placement || placement.traktSeason === null || !sameSeason(p, ref)) continue
      const suggested = placement.episodeOffset - (p.number - ref.number)
      const chain = entry.ids.mal !== undefined ? ctx.chains[entry.ids.mal] : undefined
      if (chain && suggested !== placement.episodeOffset && plausibleOffsets(chain).includes(suggested)) {
        reasons.push({ kind: 'offset', source: p.cell.source, seasonId: placement.seasonId, traktSeason: placement.traktSeason, current: placement.episodeOffset, suggested })
        explained.add(p.cell.source)
        continue
      }
      const ownNumber = ref.number - placement.episodeOffset
      if (entry.episodes && (ownNumber > entry.episodes || ownNumber < 1)) {
        reasons.push({ kind: 'link', source: p.cell.source, seasonId: placement.seasonId, traktEpisode: episodeLabel(ref), episodes: entry.episodes })
        explained.add(p.cell.source)
      }
    }
  }

  // 3. Same place, but one source is caught up while another lists the next episode.
  for (const a of points) {
    for (const b of points) {
      if (a === b || !a.listed || b.listed || !sameSeason(a, b) || a.number !== b.number) continue
      if (explained.has(a.cell.source) || explained.has(b.cell.source)) continue
      if (a.airedAt && new Date(a.airedAt).getTime() > ctx.now) {
        reasons.push({ kind: 'not_aired', source: a.cell.source, episode: episodeLabel(a.cell.entry!.next), airsAt: a.airedAt })
        explained.add(a.cell.source)
      } else {
        reasons.push({ kind: 'not_listed_yet', source: b.cell.source, episode: episodeLabel({ season: b.season === null ? null : b.season, number: b.number }), listedBy: a.cell.source })
        explained.add(b.cell.source)
      }
    }
  }

  // 4. Ahead by more episodes than the marks logged here since the other source's last mark.
  for (const p of points.slice(1)) {
    if (explained.has(p.cell.source) || explained.has(ref.cell.source) || !sameSeason(p, ref) || p.number === ref.number) continue
    const [ahead, behind] = p.number > ref.number ? [p, ref] : [ref, p]
    const gap = ahead.number - behind.number
    const ok = ctx.writes.filter(w => w.result === 'ok')
    const behindLast = Math.max(0, ...ok.filter(w => w.source === behind.cell.source).map(w => w.at.getTime()))
    const logged = ok.filter(w => w.source === ahead.cell.source && w.at.getTime() > behindLast).length
    if (logged < gap) reasons.push({ kind: 'outside', source: ahead.cell.source, by: gap - logged, than: behind.cell.source })
  }

  return reasons
}
