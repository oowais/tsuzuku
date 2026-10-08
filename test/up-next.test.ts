import { describe, expect, it } from 'vitest'
import { entriesFrom } from '../server/lib/entries'
import { buildUpNext, type UpNextInput } from '../server/lib/up-next'

// Raw shapes as seen in real responses, made-up values.
const trakt = (id: number, next: { season: number, number: number } | null, extra: Record<string, unknown> = {}) => ({
  show: { title: `Trakt ${id}`, year: 2020, ids: { trakt: id, slug: `t-${id}`, ...extra } },
  progress: { aired: 20, completed: 5, last_watched_at: '2026-10-01T00:00:00Z', next_episode: next }
})
const simkl = (id: number, next: string | null, ids: Record<string, unknown> = {}, at = '2026-09-01T00:00:00Z') => ({
  status: 'watching', next_to_watch: next, last_watched_at: at, watched_episodes_count: 5, total_episodes_count: 12, not_aired_episodes_count: 0,
  show: { title: `Simkl ${id}`, ids: { simkl: id, ...ids } }
})
const mal = (id: number, watched: number) => ({
  node: { id, title: `Mal ${id}`, num_episodes: 12, media_type: 'tv' },
  list_status: { status: 'watching', num_episodes_watched: watched, updated_at: '2026-08-01T00:00:00+00:00' }
})

const ok = { stale: false, blocked: false }
type Mapping = UpNextInput['mappings'][number]
const now = new Date()
const mapping = (m: Partial<Mapping> & { id: number }): Mapping => ({
  userId: 1, traktId: null, traktSlug: null, simklId: null, malId: null, tmdbId: null, anilistId: null,
  kind: 'anime', status: 'confirmed', createdAt: now, updatedAt: now, seasons: [], ...m
})
const season = (s: Partial<Mapping['seasons'][number]> & { id: number, mappingId: number }): Mapping['seasons'][number] => ({
  userId: 1, traktSeason: null, malId: null, anilistId: null, simklId: null, episodeOffset: 0, episodeCount: null, createdAt: now, updatedAt: now, ...s
})

function build(lists: Parameters<typeof entriesFrom>[0], mappings: Mapping[], flags: Partial<UpNextInput['flags']> = {}, accepted: Record<string, string> = {}) {
  return buildUpNext({ entries: entriesFrom(lists).entries, mappings, traktTitles: { 9: 'Off-list show' }, flags: { trakt: ok, simkl: ok, mal: ok, ...flags }, accepted })
}

describe('up next', () => {
  const anime = mapping({ id: 1, traktId: 1, traktSlug: 't-1', seasons: [season({ id: 1, mappingId: 1, traktSeason: 3, malId: 50, simklId: 5 })] })

  it('compares each source in Trakt numbering and flags any difference', () => {
    const [row] = build({ trakt: [trakt(1, { season: 3, number: 7 })], simkl: { anime: [simkl(5, 'E7', { mal: '50' })] }, mal: { data: [mal(50, 5)] } }, [anime])
    expect(row).toMatchObject({ section: 'trakt', kind: 'anime', title: 'Trakt 1', differs: true })
    expect(row!.cells.simkl).toMatchObject({ state: 'differs', traktNext: { season: 3, number: 7 } })
    expect(row!.cells.mal).toMatchObject({ state: 'differs', traktNext: { season: 3, number: 6 } })
    expect(row!.signature).toBe('mal:3x6|simkl:3x7|trakt:3x7')
    expect(row!.accepted).toBe(false)
  })

  it('accepts a difference only while every source still shows the accepted positions', () => {
    const lists = (malWatched: number) => ({ trakt: [trakt(1, { season: 3, number: 7 })], simkl: { anime: [simkl(5, 'E7', { mal: '50' })] }, mal: { data: [mal(50, malWatched)] } })
    const accepted = { 'm:1': 'mal:3x6|simkl:3x7|trakt:3x7' }
    expect(build(lists(5), [anime], {}, accepted)[0]).toMatchObject({ differs: true, accepted: true })
    // MAL moves on: a different difference, flagged again.
    expect(build(lists(4), [anime], {}, accepted)[0]).toMatchObject({ differs: true, accepted: false })
    // Sources agree: nothing to accept.
    expect(build(lists(6), [anime], {}, accepted)[0]).toMatchObject({ differs: false, accepted: false })
  })

  it('marks agreeing sources in sync, applying the episode offset', () => {
    const offset = mapping({ ...anime, seasons: [season({ id: 1, mappingId: 1, traktSeason: 1, episodeOffset: 48, simklId: 5 })] })
    const [row] = build({ trakt: [trakt(1, { season: 1, number: 49 })], simkl: { anime: [simkl(5, 'E1')] } }, [offset])
    expect(row).toMatchObject({ differs: false, cells: { trakt: { state: 'in_sync' }, simkl: { state: 'in_sync' }, mal: { state: 'unmapped' } } })
  })

  it('does not compare an entry whose Trakt season is not set', () => {
    const unplaced = mapping({ ...anime, seasons: [season({ id: 1, mappingId: 1, simklId: 5 })] })
    const [row] = build({ trakt: [trakt(1, { season: 3, number: 7 })], simkl: { anime: [simkl(5, 'E2')] } }, [unplaced])
    expect(row).toMatchObject({ differs: false, cells: { trakt: { state: 'alone' }, simkl: { state: 'not_placed' } } })
  })

  it('shows a Trakt show with no links as alone, with the others unmapped', () => {
    const [row] = build({ trakt: [trakt(2, { season: 1, number: 2 })] }, [])
    expect(row).toMatchObject({ kind: 'unknown', cells: { trakt: { state: 'alone' }, simkl: { state: 'unmapped' }, mal: { state: 'unmapped' } } })
  })

  it('compares a show-level link in season and episode, without a MAL column', () => {
    const show = mapping({ id: 2, kind: 'show', status: 'auto', traktId: 2, simklId: 6 })
    const [row] = build({ trakt: [trakt(2, { season: 2, number: 3 })], simkl: { shows: [simkl(6, 'S02E03')] } }, [show])
    expect(row).toMatchObject({ kind: 'show', differs: false, cells: { trakt: { state: 'in_sync' }, simkl: { state: 'in_sync' } } })
    expect(row!.cells.mal).toBeUndefined()
  })

  it('puts shows Trakt does not list after the Trakt rows, something to watch first, then by last activity', () => {
    const rows = build({
      trakt: [trakt(1, { season: 3, number: 7 })],
      simkl: { shows: [simkl(6, null, {}, '2026-10-05T00:00:00Z'), simkl(7, 'S01E02', {}, '2026-01-01T00:00:00Z')] }
    }, [anime, mapping({ id: 2, kind: 'show', status: 'auto', traktId: 9, traktSlug: 'off', simklId: 6 })])
    expect(rows.map(r => [r.section, r.title])).toEqual([['trakt', 'Trakt 1'], ['other', 'Simkl 7'], ['other', 'Simkl 6']])
    expect(rows[2]!.cells.trakt).toMatchObject({ state: 'not_in_list', ref: { title: 'Off-list show', traktSlug: 'off' } })
    expect(rows[2]!.cells.simkl).toMatchObject({ state: 'caught_up' })
    expect(rows[1]!.cells.trakt).toMatchObject({ state: 'unmapped' })
  })

  it('never shows an unlinked show-level link as linked', () => {
    const rows = build({ trakt: [trakt(2, { season: 1, number: 1 })], simkl: { shows: [simkl(6, 'S01E01')] } },
      [mapping({ id: 2, kind: 'show', status: 'rejected', traktId: 2, simklId: 6 })])
    expect(rows.find(r => r.section === 'trakt')).toMatchObject({ cells: { simkl: { state: 'unmapped' } } })
    expect(rows.find(r => r.title === 'Simkl 6')).toMatchObject({ section: 'other', cells: { trakt: { state: 'unmapped' } } })
  })

  it('carries rate limit and stale flags onto every cell of that source', () => {
    const [row] = build({ trakt: [trakt(1, { season: 3, number: 7 })], simkl: { anime: [simkl(5, 'E7', { mal: '50' })] } }, [anime], { simkl: { stale: true, blocked: true } })
    expect(row!.cells.simkl).toMatchObject({ stale: true, blocked: true })
    expect(row!.cells.trakt).toMatchObject({ stale: false, blocked: false })
  })

  it('uses the season entry poster for anime and the Trakt season poster for shows', () => {
    const withPoster = (raw: ReturnType<typeof simkl>, poster: string) => ({ ...raw, show: { ...raw.show, poster } })
    const t = trakt(1, { season: 3, number: 7 })
    const tWithImage = { ...t, show: { ...t.show, images: { poster: ['media.trakt.tv/show.jpg'] } } }
    const [animeRow] = buildUpNext({
      entries: entriesFrom({ trakt: [tWithImage], simkl: { anime: [withPoster(simkl(5, 'E7', { mal: '50' }), '1/abc')] } }).entries,
      mappings: [anime], traktTitles: {}, flags: { trakt: ok, simkl: ok, mal: ok },
      traktSeasonPosters: { 1: { 3: 'https://media.trakt.tv/s3.jpg' } }
    })
    expect(animeRow!.images).toEqual(['https://simkl.in/posters/1/abc_m.jpg', 'https://media.trakt.tv/s3.jpg', 'https://media.trakt.tv/show.jpg'])

    const t2 = trakt(2, { season: 2, number: 3 })
    const [showRow] = buildUpNext({
      entries: entriesFrom({ trakt: [{ ...t2, show: { ...t2.show, images: { poster: ['media.trakt.tv/show.jpg'] } } }] }).entries,
      mappings: [], traktTitles: {}, flags: { trakt: ok, simkl: ok, mal: ok },
      traktSeasonPosters: { 2: { 2: 'https://media.trakt.tv/s2.jpg' } }
    })
    expect(showRow!.images).toEqual(['https://media.trakt.tv/s2.jpg', 'https://media.trakt.tv/show.jpg'])
  })
})
