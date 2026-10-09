import { episodeLabel } from '../../shared/utils/source-links'
import type { Entry, ListSource } from './entries'
import type { Cell, Row } from './up-next'

// "Mark next watched" (decision #13): each source marks its own next episode, in its own numbering.
// When every source on a row agrees on the next episode, one click covers them all; otherwise each source
// is marked on its own. Either way the preview lists what changes per source, and nothing is written
// until you confirm. Planning is pure; the writes happen in the confirm route.

// The list status to set with the episode (#52), when it is the last one the source has. Null leaves the
// status to the source: Simkl files the item itself (Completed once everything is watched), MAL stays on
// Watching. Trakt has no list status.
export type AfterStatus = 'completed' | 'hold' | 'dropped'
export const AFTER_LABELS: Record<AfterStatus, string> = { completed: 'Completed', hold: 'On hold', dropped: 'Dropped' }

export type MarkWrite
  = | { source: 'trakt', show: number, season: number, number: number }
    | { source: 'simkl', kind: 'show' | 'anime', simkl: number, season: number | null, number: number, status: 'hold' | 'dropped' | null }
    | { source: 'mal', mal: number, watched: number, status: AfterStatus | null }

export interface MarkStep {
  source: ListSource
  // The source's own title and the episode in its own numbering.
  title: string
  episode: string
  // For the write log, and a shorter form for the preview.
  summary: string
  note: string
  // What the source showed when this was planned: the confirm refuses the write if it has moved since.
  expected: string
  write: MarkWrite
  // Set when a source on the row dates this episode in the future. Marking it stays possible (a source's
  // database can lag behind the real airing); the preview warns instead (#43).
  airsAt: { date: string, by: ListSource } | null
  // The statuses offered with the last episode the source has, and the one picked unless you change it
  // (null: leave it to the source). Null when the episode is not the last one or the source has no status.
  after: { options: AfterStatus[], suggested: AfterStatus | null } | null
}

export interface MarkSkip {
  source: ListSource
  reason: string
}

export interface MarkPlan {
  rowKey: string
  title: string
  mode: 'all' | 'one'
  // The episode being marked, as the preview's heading: in Trakt's numbering where known, with a name and
  // air date from whichever source on the row has them for the same episode.
  episode: { label: string, name: string | null, airedAt: string | null } | null
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

// The position Up Next compares: Trakt numbering where known, else the entry's own (as in buildUpNext).
function positionOf(row: Row, c: Cell): string | null {
  const next = c.source === 'trakt' || row.kind === 'show' ? c.entry?.next : c.traktNext ?? c.entry?.next
  return next ? `${next.season ?? ''}x${next.number}` : null
}

// A future air date for this cell's next episode: its own source's, else another source's for the same
// episode (MAL never dates episodes). Null when no source dates it in the future.
function futureAirDate(row: Row, cell: Cell, now: number): MarkStep['airsAt'] {
  const position = positionOf(row, cell)
  const dated = Object.values(row.cells)
    .filter((c): c is Cell => !!c?.entry?.next?.airedAt && (c === cell || (position !== null && positionOf(row, c) === position)))
    .map(c => ({ date: c.entry!.next!.airedAt!, by: c.source }))
    .filter(d => Date.parse(d.date) > now)
  return dated.find(d => d.by === cell.source) ?? dated[0] ?? null
}

// The same episode on other sources of the row, for the name and date one source lacks (MAL has neither).
function sameEpisode(row: Row, cell: Cell): Cell[] {
  const position = positionOf(row, cell)
  return Object.values(row.cells).filter((c): c is Cell => !!c?.entry?.next && (c === cell || (position !== null && positionOf(row, c) === position)))
}

function headline(row: Row, cell: Cell): MarkPlan['episode'] {
  const next = cell.entry?.next
  if (!next) return null
  const same = sameEpisode(row, cell)
  const shown = cell.source === 'trakt' || row.kind === 'show' ? next : cell.traktNext ?? next
  return {
    label: episodeLabel(shown),
    name: same.map(c => c.entry!.next!.title).find(t => !!t) ?? null,
    airedAt: same.map(c => c.entry!.next!.airedAt).find(d => !!d) ?? null
  }
}

// The step with this list status set (null: left to the source), or an error when it is not offered.
export function withAfter(step: MarkStep, status: AfterStatus | null): MarkStep | string {
  if (status !== null && !step.after?.options.includes(status)) return `${AFTER_LABELS[status]} is not offered here`
  const w = step.write
  const label = status ? AFTER_LABELS[status].toLowerCase() : null
  const base = { ...step, summary: step.summary.replace(/, set [a-z ]+$/, ''), note: step.note.replace(/, [a-z ]+$/, '') }
  const done = label ? { summary: `${base.summary}, set ${label}`, note: `${base.note}, ${label}` } : {}
  if (w.source === 'mal') return { ...base, ...done, write: { ...w, status } }
  if (w.source === 'simkl') return { ...base, ...done, write: { ...w, status: status === 'completed' ? null : status } }
  return step
}

function step(row: Row, cell: Cell, now: number): MarkStep | string {
  const e = cell.entry
  if (!e?.next) return 'nothing to mark'
  const next = e.next
  const base = { source: cell.source, title: e.title, episode: episodeLabel(next), expected: expectedOf(e), airsAt: futureAirDate(row, cell, now), after: null }
  // The last episode the source has: Simkl counts aired episodes, MAL the planned total (0 while airing).
  const last = e.episodes !== null && e.episodes > 0 && e.watched + 1 >= e.episodes
  switch (cell.source) {
    case 'trakt':
      if (next.season === null || !e.ids.trakt) return 'no season on Trakt\'s next episode'
      return { ...base, summary: `Add ${base.episode} to history, watched now`, note: 'to history', write: { source: 'trakt', show: e.ids.trakt, season: next.season, number: next.number } }
    case 'simkl':
      if (!e.ids.simkl) return 'no Simkl ID'
      if (e.kind === 'show' && next.season === null) return 'no season on Simkl\'s next episode'
      return {
        ...base,
        summary: `Add ${base.episode} to history, watched now`,
        note: 'to history',
        // Simkl moves a finished item to Completed itself; only the other statuses are worth offering.
        after: last ? { options: ['hold', 'dropped'], suggested: null } : null,
        write: { source: 'simkl', kind: e.kind, simkl: e.ids.simkl, season: e.kind === 'show' ? next.season : null, number: next.number, status: null }
      }
    case 'mal': {
      if (!e.ids.mal) return 'no MAL ID'
      const watched = e.watched + 1
      const s: MarkStep = {
        ...base,
        summary: `Watched ${e.watched} → ${watched}${e.episodes ? ` of ${e.episodes}` : ''}`,
        note: `${e.watched} → ${watched}${e.episodes ? ` of ${e.episodes}` : ''}`,
        after: last ? { options: ['completed', 'hold', 'dropped'], suggested: 'completed' } : null,
        write: { source: 'mal', mal: e.ids.mal, watched, status: null }
      }
      return last ? withAfter(s, 'completed') : s
    }
  }
}

// What a click on the row (agreeing sources) or on one source's cell would write.
export function planMark(row: Row, source?: ListSource, now = Date.now()): MarkPlan {
  const plan: MarkPlan = { rowKey: row.key, title: row.title, mode: row.agrees ? 'all' : 'one', episode: null, steps: [], skipped: [] }

  if (plan.mode === 'all') {
    const lead = (['trakt', 'simkl', 'mal'] as const).map(s => row.cells[s]).find(c => c?.state === 'in_sync' && c.entry?.next)
    plan.episode = lead ? headline(row, lead) : null
    for (const cell of Object.values(row.cells)) {
      if (!cell) continue
      const reason = cell.state === 'in_sync' ? blockedReason(cell) : SKIP_REASONS[cell.state]
      if (reason) {
        plan.skipped.push({ source: cell.source, reason })
        continue
      }
      if (cell.state !== 'in_sync') continue
      const s = step(row, cell, now)
      if (typeof s === 'string') plan.skipped.push({ source: cell.source, reason: `skipped, ${s}` })
      else plan.steps.push(s)
    }
    return plan
  }

  const cell = source ? row.cells[source] : undefined
  if (!cell) throw new MarkError('Pick a source to mark')
  const reason = blockedReason(cell)
  if (reason) throw new MarkError(`${cell.source}: ${reason}`)
  const s = step(row, cell, now)
  if (typeof s === 'string') throw new MarkError(`${cell.source}: ${s}`)
  plan.episode = headline(row, cell)
  plan.steps.push(s)
  return plan
}
