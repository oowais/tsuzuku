import { describe, expect, it } from 'vitest'
import { MarkError, planMark } from '../server/lib/mark-watched'
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
      { source: 'simkl', kind: 'anime', simkl: 5, season: null, number: 7 },
      { source: 'mal', mal: 50, watched: 12, completed: true }
    ])
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
})
