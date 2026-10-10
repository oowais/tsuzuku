import { describe, expect, it } from 'vitest'
import { MarkError, planMark, withAfter, withRating } from '../server/lib/mark-watched'
import type { Cell, Row } from '../server/lib/up-next'
import type { Entry } from '../server/lib/entries'

const entry = (source: Entry['source'], e: Partial<Entry>): Entry => ({
  source, key: `${source}:1`, kind: 'anime', format: null, title: `${source} title`, altTitles: [], year: null,
  ids: {}, watched: 6, episodes: 12, next: { season: null, number: 7, title: null }, lastActivityAt: null, airing: null, image: null, ...e
})
const cell = (source: Cell['source'], state: Cell['state'], e: Partial<Entry> | null, extra: Partial<Cell> = {}): Cell => ({
  source, state, entry: e ? entry(source, e) : null, ref: null, traktNext: null, stale: false, blocked: false, retryAfter: null, ...extra
})
const row = (cells: Row['cells'], extra: Partial<Row> = {}): Row => ({
  key: 'm:1', section: 'trakt', kind: 'anime', title: 'Show', cells, differs: false, signature: '', accepted: false, agrees: true,
  hasNext: true, lastActivityAt: null, images: [], ...extra
})

const traktCell = cell('trakt', 'in_sync', { kind: 'show', ids: { trakt: 9 }, watched: 30, next: { season: 3, number: 7, title: 'Ep' } })
const simklCell = cell('simkl', 'in_sync', { ids: { simkl: 5 } })
const malCell = cell('mal', 'in_sync', { ids: { mal: 50 }, watched: 11 })

describe('mark watched plan', () => {
  it('covers every agreeing source, each in its own numbering', () => {
    const plan = planMark(row({ trakt: traktCell, simkl: simklCell, mal: malCell }))
    expect(plan.mode).toBe('all')
    expect(plan.steps.map(s => [s.source, s.episode, s.summary])).toEqual([
      ['trakt', 'S3E7', 'Add S3E7 to history, watched now'],
      ['simkl', 'E7', 'Add E7 to history, watched now'],
      ['mal', 'E7', 'Watched 11 → 12 of 12, set completed']
    ])
    expect(plan.steps.map(s => s.write)).toEqual([
      { source: 'trakt', show: 9, season: 3, number: 7 },
      { source: 'simkl', kind: 'anime', simkl: 5, season: null, number: 7, status: null },
      { source: 'mal', mal: 50, watched: 12, status: 'completed' }
    ])
  })

  it('heads the preview with the episode in Trakt numbering, named and dated by any source', () => {
    const named = cell('simkl', 'in_sync', { ids: { simkl: 5 }, next: { season: null, number: 7, title: 'Seventh', airedAt: '2026-10-01' } }, { traktNext: { season: 3, number: 7 } })
    expect(planMark(row({ trakt: traktCell, simkl: named, mal: malCell })).episode).toEqual({ label: 'S3E7', name: 'Ep', airedAt: '2026-10-01' })
    // One source on its own: its Trakt position, and the name from the other source on the same episode.
    const mal = { ...malCell, state: 'differs' as const, traktNext: { season: 3, number: 7 } }
    expect(planMark(row({ trakt: traktCell, mal }, { agrees: false, differs: true }), 'mal').episode).toEqual({ label: 'S3E7', name: 'Ep', airedAt: null })
    expect(planMark(row({ trakt: traktCell, mal: malCell })).steps.map(s => s.note)).toEqual(['to history', '11 → 12 of 12, completed'])
  })

  it('offers a list status with the last episode a source has', () => {
    const last = planMark(row({ trakt: traktCell, simkl: cell('simkl', 'in_sync', { ids: { simkl: 5 }, watched: 11 }), mal: malCell })).steps
    expect(last.map(s => [s.source, s.after])).toEqual([
      ['trakt', null],
      ['simkl', { options: ['hold', 'dropped'], suggested: null }],
      ['mal', { options: ['completed', 'hold', 'dropped'], suggested: 'completed' }]
    ])
    // Not the last one: nothing to choose, and MAL keeps its status.
    const mid = planMark(row({ trakt: traktCell, simkl: simklCell, mal: { ...malCell, entry: { ...malCell.entry!, watched: 5 } } })).steps
    expect(mid.map(s => s.after)).toEqual([null, null, null])
    expect(mid[2]!.write).toMatchObject({ status: null })
    // Simkl's last aired episode while more are still to air (an airing season): not its end.
    expect(planMark(row({ simkl: cell('simkl', 'in_sync', { ids: { simkl: 5 }, watched: 11, notAired: 2 }) })).steps[0]!.after).toBeNull()
    // MAL reports 0 episodes while airing: never the last one.
    expect(planMark(row({ mal: { ...malCell, entry: { ...malCell.entry!, episodes: 0 } } })).steps[0]!.after).toBeNull()
  })

  it('applies the picked status to the write and the log summary', () => {
    const [, simkl, mal] = planMark(row({ trakt: traktCell, simkl: cell('simkl', 'in_sync', { ids: { simkl: 5 }, watched: 11 }), mal: malCell })).steps
    expect(withAfter(mal!, 'hold')).toMatchObject({ summary: 'Watched 11 → 12 of 12, set on hold', note: '11 → 12 of 12, on hold', write: { status: 'hold' } })
    expect(withAfter(mal!, null)).toMatchObject({ summary: 'Watched 11 → 12 of 12', write: { status: null } })
    expect(withAfter(simkl!, 'dropped')).toMatchObject({ summary: 'Add E7 to history, watched now, set dropped', write: { status: 'dropped' } })
    expect(withAfter(simkl!, 'completed')).toBe('Completed is not offered here')
  })

  it('lists blocked, stale and unlinked sources as skipped', () => {
    const plan = planMark(row({
      trakt: traktCell,
      simkl: { ...simklCell, blocked: true, retryAfter: 42 },
      mal: cell('mal', 'unmapped', null)
    }))
    expect(plan.steps.map(s => s.source)).toEqual(['trakt'])
    expect(plan.skipped).toEqual([{ source: 'simkl', reason: 'blocked, retry in 42s' }, { source: 'mal', reason: 'skipped, needs mapping' }])
    expect(planMark(row({ trakt: traktCell, mal: { ...malCell, stale: true } })).skipped).toEqual([{ source: 'mal', reason: 'skipped, could not read it just now' }])
  })

  it('marks only the clicked source when the sources differ', () => {
    const plan = planMark(row({ trakt: traktCell, simkl: { ...simklCell, state: 'differs' }, mal: malCell }, { agrees: false, differs: true }), 'simkl')
    expect(plan).toMatchObject({ mode: 'one', skipped: [] })
    expect(plan.steps.map(s => s.source)).toEqual(['simkl'])
  })

  it('refuses a single source that is blocked or has nothing next', () => {
    const differs = { agrees: false, differs: true }
    expect(() => planMark(row({ simkl: { ...simklCell, blocked: true } }, differs), 'simkl')).toThrow(MarkError)
    expect(() => planMark(row({ simkl: cell('simkl', 'caught_up', { ids: { simkl: 5 }, next: null }) }, differs), 'simkl')).toThrow('nothing to mark')
    expect(() => planMark(row({}, differs))).toThrow(MarkError)
  })

  it('needs a season for Simkl shows', () => {
    const show = cell('simkl', 'alone', { kind: 'show', ids: { simkl: 6 }, next: { season: null, number: 3, title: null } })
    expect(() => planMark(row({ simkl: show }, { agrees: false }), 'simkl')).toThrow('no season')
  })

  it('records what the source showed, so a moved source is detected', () => {
    const [a] = planMark(row({ trakt: traktCell, mal: malCell })).steps
    const [b] = planMark(row({ trakt: { ...traktCell, entry: { ...traktCell.entry!, watched: 31, next: { season: 3, number: 8, title: null } } }, mal: malCell })).steps
    expect(a!.expected).not.toBe(b!.expected)
  })

  describe('air dates', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')
    const dated = (c: Cell, airedAt: string): Cell => ({ ...c, entry: { ...c.entry!, next: { ...c.entry!.next!, airedAt } } })
    const anime = (cells: Row['cells'], extra: Partial<Row> = {}) => row(cells, { section: 'other', kind: 'anime', ...extra })

    it('warns on every agreeing source when one dates the episode in the future, MAL included', () => {
      const plan = planMark(anime({ simkl: dated(simklCell, '2026-10-12T00:00:00+09:00'), mal: malCell }), undefined, now)
      expect(plan.steps.map(s => [s.source, s.airsAt])).toEqual([
        ['simkl', { date: '2026-10-12T00:00:00+09:00', by: 'simkl' }],
        ['mal', { date: '2026-10-12T00:00:00+09:00', by: 'simkl' }]
      ])
    })

    it('prefers the source\'s own date', () => {
      const plan = planMark(row({ trakt: dated(traktCell, '2026-10-11T10:00:00Z'), simkl: dated({ ...simklCell, traktNext: { season: 3, number: 7, title: null } }, '2026-10-12T00:00:00+09:00') }), undefined, now)
      expect(plan.steps.map(s => s.airsAt?.by)).toEqual(['trakt', 'simkl'])
    })

    it('does not warn for aired episodes or episodes no source dates', () => {
      expect(planMark(anime({ simkl: dated(simklCell, '2026-10-01T00:00:00+09:00'), mal: malCell }), undefined, now).steps.every(s => s.airsAt === null)).toBe(true)
      expect(planMark(row({ trakt: traktCell, mal: malCell }), undefined, now).steps.every(s => s.airsAt === null)).toBe(true)
    })

    it('does not take a date from another source on a different episode', () => {
      const plan = planMark(anime({ simkl: dated({ ...simklCell, state: 'differs', entry: { ...simklCell.entry!, next: { season: null, number: 8, title: null } } }, '2026-10-12T00:00:00+09:00'), mal: { ...malCell, state: 'differs' } }, { agrees: false, differs: true }), 'mal', now)
      expect(plan.steps[0]!.airsAt).toBeNull()
    })
  })

  it('offers a rating with the last episode, scoped to what each source rates', () => {
    const last = planMark(row({ trakt: { ...traktCell, entry: { ...traktCell.entry!, watched: 29, episodes: 30 } }, simkl: { ...simklCell, entry: { ...simklCell.entry!, watched: 11, rating: 6 } }, mal: { ...malCell, entry: { ...malCell.entry!, rating: 9 } } })).steps
    expect(last.map(s => [s.source, s.rating])).toEqual([
      ['trakt', { scope: 'show', current: null, unknown: false }],
      ['simkl', { scope: 'show', current: 6, unknown: false }],
      ['mal', { scope: 'season', current: 9, unknown: false }]
    ])
    // Not the last episode: nothing to rate.
    expect(planMark(row({ trakt: { ...traktCell, entry: { ...traktCell.entry!, episodes: 40 } }, simkl: simklCell, mal: { ...malCell, entry: { ...malCell.entry!, watched: 5 } } })).steps.map(s => s.rating)).toEqual([null, null, null])
  })

  it('puts the score on the write and the log summary, and refuses one that is not offered', () => {
    const [simkl, mal] = planMark(row({ simkl: { ...simklCell, entry: { ...simklCell.entry!, watched: 11 } }, mal: malCell })).steps
    expect(withRating(mal!, 8)).toMatchObject({ summary: 'Watched 11 → 12 of 12, set completed, rated 8', write: { source: 'mal', status: 'completed', rating: 8 } })
    expect(withRating(mal!, null)).toBe(mal)
    expect(withRating(mal!, 11)).toBe('A rating is a whole number from 1 to 10')
    expect(withRating(simkl!, 7)).toMatchObject({ write: { source: 'simkl', rating: 7 } })
    const mid = planMark(row({ simkl: { ...simklCell, entry: { ...simklCell.entry!, watched: 2 } } })).steps[0]!
    expect(withRating(mid, 7)).toBe('Rating is not offered here')
  })
})
