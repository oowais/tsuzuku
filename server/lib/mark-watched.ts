import { episodeLabel } from '../../shared/utils/source-links'
import type { Entry, ListSource } from './entries'
import type { Cell, Row } from './up-next'

// "Mark next watched" (decision #13): each source marks its own next episode, in its own numbering.
// When every source on a row agrees on the next episode, one click covers them all; otherwise each source
// is marked on its own. Either way the preview lists what changes per source, and nothing is written
// until you confirm. Planning is pure; the writes happen in the confirm route.

export type MarkWrite
  = | { source: 'trakt', show: number, season: number, number: number }
    | { source: 'simkl', kind: 'show' | 'anime', simkl: number, season: number | null, number: number }
    | { source: 'mal', mal: number, watched: number, completed: boolean }

export interface MarkStep {
  source: ListSource
  // The source's own title and the episode in its own numbering.
  title: string
  episode: string
  summary: string
  // What the source showed when this was planned: the confirm refuses the write if it has moved since.
  expected: string
  write: MarkWrite
}

export interface MarkSkip {
  source: ListSource
  reason: string
}

export interface MarkPlan {
  rowKey: string
  title: string
  mode: 'all' | 'one'
  steps: MarkStep[]
  skipped: MarkSkip[]
}

export class MarkError extends Error {}

const SKIP_REASONS: Partial<Record<Cell['state'], string>> = {
  not_placed: 'skipped, Trakt season not set',
  unmapped: 'skipped, needs mapping',
  not_in_list: 'skipped, not on your list'
}

const expectedOf = (e: Entry) => `${e.watched}|${e.next ? `${e.next.season ?? ''}x${e.next.number}` : 'none'}`

// Why this source cannot be written now, or null when it can.
function blockedReason(cell: Cell): string | null {
  if (cell.blocked) return cell.retryAfter ? `blocked, retry in ${cell.retryAfter}s` : 'blocked, retry later'
  // A cached list cannot prove what the source shows now.
  if (cell.stale) return 'skipped, could not read it just now'
  return null
}

function step(cell: Cell): MarkStep | string {
  const e = cell.entry
  if (!e?.next) return 'nothing to mark'
  const next = e.next
  const base = { source: cell.source, title: e.title, episode: episodeLabel(next), expected: expectedOf(e) }
  switch (cell.source) {
    case 'trakt':
      if (next.season === null || !e.ids.trakt) return 'no season on Trakt\'s next episode'
      return { ...base, summary: `Add ${base.episode} to history, watched now`, write: { source: 'trakt', show: e.ids.trakt, season: next.season, number: next.number } }
    case 'simkl':
      if (!e.ids.simkl) return 'no Simkl ID'
      if (e.kind === 'show' && next.season === null) return 'no season on Simkl\'s next episode'
      return { ...base, summary: `Add ${base.episode} to history, watched now`, write: { source: 'simkl', kind: e.kind, simkl: e.ids.simkl, season: e.kind === 'show' ? next.season : null, number: next.number } }
    case 'mal': {
      if (!e.ids.mal) return 'no MAL ID'
      const watched = e.watched + 1
      const completed = e.episodes !== null && watched >= e.episodes
      return {
        ...base,
        summary: `Watched ${e.watched} → ${watched}${e.episodes !== null ? ` of ${e.episodes}` : ''}${completed ? ', set completed' : ''}`,
        write: { source: 'mal', mal: e.ids.mal, watched, completed }
      }
    }
  }
}

// What a click on the row (agreeing sources) or on one source's cell would write.
export function planMark(row: Row, source?: ListSource): MarkPlan {
  const plan: MarkPlan = { rowKey: row.key, title: row.title, mode: row.agrees ? 'all' : 'one', steps: [], skipped: [] }

  if (plan.mode === 'all') {
    for (const cell of Object.values(row.cells)) {
      if (!cell) continue
      const reason = cell.state === 'in_sync' ? blockedReason(cell) : SKIP_REASONS[cell.state]
      if (reason) {
        plan.skipped.push({ source: cell.source, reason })
        continue
      }
      if (cell.state !== 'in_sync') continue
      const s = step(cell)
      if (typeof s === 'string') plan.skipped.push({ source: cell.source, reason: `skipped, ${s}` })
      else plan.steps.push(s)
    }
    return plan
  }

  const cell = source ? row.cells[source] : undefined
  if (!cell) throw new MarkError('Pick a source to mark')
  const reason = blockedReason(cell)
  if (reason) throw new MarkError(`${cell.source}: ${reason}`)
  const s = step(cell)
  if (typeof s === 'string') throw new MarkError(`${cell.source}: ${s}`)
  plan.steps.push(s)
  return plan
}
