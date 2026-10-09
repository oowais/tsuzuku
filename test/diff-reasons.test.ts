import { describe, expect, it } from 'vitest'
import { explainDifference, type LoggedWrite, type ReasonContext } from '../server/lib/diff-reasons'
import type { Entry, ListSource, NextEpisode } from '../server/lib/entries'
import type { ChainStep } from '../server/lib/seasons'
import type { Cell, Row } from '../server/lib/up-next'

const NOW = Date.UTC(2026, 9, 9, 12)
const DAY = 24 * 60 * 60 * 1000

const entry = (source: ListSource, next: NextEpisode | null, over: Partial<Entry> = {}): Entry => ({
  source, key: `${source}:1`, kind: source === 'trakt' ? 'show' : 'anime', format: null, title: 'X', altTitles: [], year: null,
  ids: source === 'trakt' ? { trakt: 1 } : { mal: 100 }, watched: next ? next.number - 1 : 12, episodes: null, next,
  lastActivityAt: null, airing: null, image: null, ...over
})
const cell = (source: ListSource, e: Entry | null, over: Partial<Cell> = {}): Cell => ({
  source, state: 'differs', entry: e, ref: null, traktNext: null, stale: false, blocked: false, retryAfter: null, ...over
})
const placed = (offset: number, season = 2) => ({ placement: { mappingId: 1, seasonId: 7, traktSeason: season, episodeOffset: offset } })
const row = (kind: Row['kind'], cells: Row['cells']): Row => ({
  key: 'm:1', section: 'trakt', kind, title: 'X', cells, differs: true, signature: '', accepted: false, agrees: false, hasNext: true, lastActivityAt: null, images: []
})
const ctx = (over: Partial<ReasonContext> = {}): ReasonContext => ({ writes: [], chains: {}, now: NOW, ...over })
const ep = (season: number | null, number: number, airedAt: string | null = null): NextEpisode => ({ season, number, title: null, airedAt })
const step = (malId: number, episodes: number | null): ChainStep => ({ malId, anilistId: malId, format: 'TV', episodes, year: null, titles: [] })
const write = (source: ListSource, daysAgo: number, markId: string | null, result: LoggedWrite['result'] = 'ok'): LoggedWrite => ({ source, at: new Date(NOW - daysAgo * DAY), markId, result })

describe('why a row differs', () => {
  it('a mark that reached Trakt only leaves Simkl one behind', () => {
    const r = row('show', { trakt: cell('trakt', entry('trakt', ep(1, 5))), simkl: cell('simkl', entry('simkl', ep(1, 4))) })
    const reasons = explainDifference(r, ctx({ writes: [write('trakt', 1, 'a'), write('simkl', 1, 'a', 'error'), write('trakt', 3, 'b'), write('simkl', 3, 'b')] }))
    expect(reasons).toEqual([{ kind: 'partial_mark', at: new Date(NOW - DAY).toISOString(), reached: ['trakt'], behind: 'simkl' }])
  })

  it('split cour with absolute numbering: offset 12 from the chain, not 0', () => {
    // Trakt S1E15; the MAL entry is the second cour (E3 next) placed at offset 0. The first cour has 12 episodes.
    const r = row('anime', { trakt: cell('trakt', entry('trakt', ep(1, 15))), mal: cell('mal', entry('mal', ep(null, 3)), placed(0, 1)) })
    const reasons = explainDifference(r, ctx({ chains: { 100: [step(99, 12), step(100, 12)] } }))
    expect(reasons).toEqual([{ kind: 'offset', source: 'mal', seasonId: 7, traktSeason: 1, current: 0, suggested: 12 }])
  })

  it('an entry placed with an offset it should not have: back to 0 when Trakt restarts numbering', () => {
    const r = row('anime', { trakt: cell('trakt', entry('trakt', ep(2, 3))), mal: cell('mal', entry('mal', ep(null, 3)), placed(12)) })
    expect(explainDifference(r, ctx({ chains: { 100: [step(99, 12), step(100, 12)] } }))[0]).toMatchObject({ kind: 'offset', suggested: 0, current: 12 })
  })

  it('a One Piece-style 1-episode prequel ONA is not a season, so it offers no offset', () => {
    const chain = [step(100, 1100)]
    const r = row('anime', { trakt: cell('trakt', entry('trakt', ep(1, 1102))), mal: cell('mal', entry('mal', ep(null, 1101), { episodes: null })) })
    r.cells.mal!.placement = placed(0, 1).placement
    // Gap of 1 matches no chain offset: watched outside Tsuzuku instead.
    expect(explainDifference(r, ctx({ chains: { 100: chain } }))).toEqual([{ kind: 'outside', source: 'trakt', by: 1, than: 'mal' }])
  })

  it('Trakt past the end of the linked entry: the link may be another season', () => {
    const r = row('anime', { trakt: cell('trakt', entry('trakt', ep(2, 15))), mal: cell('mal', entry('mal', ep(null, 3), { episodes: 12 }), placed(0)) })
    expect(explainDifference(r, ctx())).toEqual([{ kind: 'link', source: 'mal', seasonId: 7, traktEpisode: 'S2E15', episodes: 12 }])
  })

  it('one source caught up while another lists the next episode: not listed yet, or not aired yet', () => {
    const caught = (airedAt: string) => row('show', {
      trakt: cell('trakt', entry('trakt', ep(1, 8, airedAt))),
      simkl: cell('simkl', entry('simkl', null, { watched: 7 }))
    })
    // A show's caught-up Simkl entry has no position, so this only works for anime entries.
    expect(explainDifference(caught(new Date(NOW - DAY).toISOString()), ctx())).toEqual([])
    const anime = (airedAt: string) => row('anime', {
      trakt: cell('trakt', entry('trakt', ep(2, 8, airedAt))),
      mal: cell('mal', entry('mal', null, { watched: 7, episodes: 12 }), placed(0))
    })
    expect(explainDifference(anime(new Date(NOW - DAY).toISOString()), ctx())).toEqual([{ kind: 'not_listed_yet', source: 'mal', episode: 'S2E8', listedBy: 'trakt' }])
    const future = new Date(NOW + DAY).toISOString()
    expect(explainDifference(anime(future), ctx())).toEqual([{ kind: 'not_aired', source: 'trakt', episode: 'S2E8', airsAt: future }])
  })

  it('ahead by more than the logged marks: watched outside Tsuzuku', () => {
    const r = row('show', { trakt: cell('trakt', entry('trakt', ep(1, 5))), simkl: cell('simkl', entry('simkl', ep(1, 8))) })
    expect(explainDifference(r, ctx({ writes: [write('simkl', 1, 'a'), write('trakt', 5, 'b'), write('simkl', 5, 'b')] }))).toEqual([{ kind: 'outside', source: 'simkl', by: 2, than: 'trakt' }])
  })

  it('says nothing for rows that agree, or with no comparable pair', () => {
    const r = row('show', { trakt: cell('trakt', entry('trakt', ep(1, 5))), simkl: cell('simkl', entry('simkl', ep(1, 5))) })
    expect(explainDifference({ ...r, differs: false }, ctx())).toEqual([])
    expect(explainDifference(row('show', { trakt: cell('trakt', entry('trakt', ep(1, 5))), simkl: cell('simkl', entry('simkl', ep(2, 1))) }), ctx())).toEqual([])
  })
})
