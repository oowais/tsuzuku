import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AniListMedia } from '../server/adapters/anilist'
import { createDb, type Db } from '../server/db'
import { mappings, mappingSeasons } from '../server/db/schema'
import { entriesFrom, type Entry } from '../server/lib/entries'
import { linkByIds } from '../server/lib/mapping'
import { buildProposals, createMappingStore, MappingError, traktRefFromEntry, traktRefFromShow } from '../server/lib/mapping-store'
import { plausibleOffsets, proposePlacement, scoreTraktShow, seasonChains, seriesPrequel, titleSimilarity, type ChainStep } from '../server/lib/seasons'

// AniList media shaped like the live API, with made-up IDs.
function media(idMal: number, opts: { title?: string, english?: string, format?: string, episodes?: number | null, year?: number, prequels?: { idMal: number, format?: string, episodes?: number | null }[] } = {}): AniListMedia {
  return {
    id: idMal + 1000,
    idMal,
    format: opts.format ?? 'TV',
    episodes: opts.episodes === undefined ? 12 : opts.episodes,
    synonyms: [],
    title: { romaji: opts.title ?? `Romaji ${idMal}`, english: opts.english ?? null, native: null },
    startDate: { year: opts.year ?? 2020 },
    relations: {
      edges: (opts.prequels ?? []).map(p => ({
        relationType: 'PREQUEL',
        node: { type: 'ANIME', format: p.format ?? 'TV', idMal: p.idMal, episodes: p.episodes === undefined ? 12 : p.episodes }
      }))
    }
  }
}

describe('seriesPrequel', () => {
  it('follows a single series prequel', () => {
    expect(seriesPrequel(media(3, { prequels: [{ idMal: 2 }] }))).toBe(2)
  })

  it('skips movies, specials and very short one-offs', () => {
    expect(seriesPrequel(media(3, { prequels: [{ idMal: 2, format: 'MOVIE' }] }))).toBeNull()
    expect(seriesPrequel(media(3, { prequels: [{ idMal: 2, format: 'ONA', episodes: 1 }] }))).toBeNull()
  })

  it('stops when there is more than one candidate', () => {
    expect(seriesPrequel(media(3, { prequels: [{ idMal: 2 }, { idMal: 1 }] }))).toBeNull()
  })

  it('follows a prequel whose episode count is not known yet', () => {
    expect(seriesPrequel(media(3, { prequels: [{ idMal: 2, episodes: null }] }))).toBe(2)
  })
})

describe('seasonChains', () => {
  it('walks back to the first season, one batched lookup per hop', async () => {
    const all: Record<number, AniListMedia> = {
      1: media(1, { english: 'Jobless' }),
      2: media(2, { prequels: [{ idMal: 1 }] }),
      3: media(3, { prequels: [{ idMal: 2 }] }),
      9: media(9)
    }
    const lookup = vi.fn(async (ids: number[]) => Object.fromEntries(ids.map(id => [id, all[id] ?? null])))

    const chains = await seasonChains([3, 9], lookup)

    expect(chains[3]!.map(s => s.malId)).toEqual([1, 2, 3])
    expect(chains[3]![0]!.titles[0]).toBe('Jobless')
    expect(chains[9]!.map(s => s.malId)).toEqual([9])
    expect(lookup.mock.calls).toEqual([[[3, 9]], [[2]], [[1]]])
  })

  it('keeps the part already walked when AniList has no data further back', async () => {
    const chains = await seasonChains([3], async ids => Object.fromEntries(ids.map(id => [id, id === 3 ? media(3, { prequels: [{ idMal: 2 }] }) : null])))
    expect(chains[3]!.map(s => s.malId)).toEqual([3])
  })

  it('does not loop on a relation cycle', async () => {
    const all: Record<number, AniListMedia> = { 1: media(1, { prequels: [{ idMal: 2 }] }), 2: media(2, { prequels: [{ idMal: 1 }] }) }
    const chains = await seasonChains([2], async ids => Object.fromEntries(ids.map(id => [id, all[id]!])))
    expect(chains[2]!.map(s => s.malId)).toEqual([1, 2])
  })
})

describe('titles and placement', () => {
  const show = (title: string, year: number | null = 2021): Entry => ({
    source: 'trakt', key: 'trakt:1', kind: 'show', format: null, title, altTitles: [], year,
    ids: { trakt: 1 }, watched: 0, episodes: null, next: { season: 3, number: 6, title: null }, lastActivityAt: null
  })
  const step = (titles: string[], year = 2021): ChainStep => ({ malId: 1, anilistId: 1, format: 'TV', episodes: 12, year, titles })

  it('scores shared words, ignoring case and punctuation', () => {
    expect(titleSimilarity('Mushoku Tensei: Jobless Reincarnation', 'mushoku tensei jobless reincarnation')).toBe(1)
    expect(titleSimilarity('Black Clover', 'Bleach')).toBe(0)
  })

  it('matches a Trakt show against the first season titles, with a small year bonus', () => {
    const chain = [step(['Mushoku Tensei: Jobless Reincarnation']), step(['Mushoku Tensei III'], 2026)]
    expect(scoreTraktShow(show('Mushoku Tensei: Jobless Reincarnation'), chain)).toBe(1)
    expect(scoreTraktShow(show('Black Clover'), chain)).toBe(0.1)
  })

  const anime = (source: 'mal' | 'simkl', next: number | null): Entry => ({
    ...show('x'), source, key: `${source}:1`, kind: 'anime', next: next === null ? null : { season: null, number: next, title: null }
  })
  const withEpisodes = (episodes: (number | null)[]) => episodes.map(e => ({ ...step(['x']), episodes: e }))

  it('lists plausible offsets from the seasons before the entry', () => {
    expect(plausibleOffsets(withEpisodes([24, 24, 12]))).toEqual([0, 24, 48])
    expect(plausibleOffsets(withEpisodes([null, 24, 12]))).toEqual([0, 24])
    expect(plausibleOffsets([])).toEqual([0])
  })

  it('places the entry where the next episodes line up', () => {
    expect(proposePlacement(show('x'), [anime('mal', 6)], [])).toEqual({ traktSeason: 3, episodeOffset: 0, fromProgress: true })
  })

  it('does not let one source being behind set an odd offset', () => {
    expect(proposePlacement(show('x'), [anime('mal', 5), anime('simkl', 6)], withEpisodes([12, 12, 12])))
      .toEqual({ traktSeason: 3, episodeOffset: 0, fromProgress: true })
  })

  it('finds a long Trakt season that spans earlier entries', () => {
    const trakt = { ...show('x'), next: { season: 1, number: 49, title: null } }
    expect(proposePlacement(trakt, [anime('simkl', 1)], withEpisodes([24, 24, 12])))
      .toEqual({ traktSeason: 1, episodeOffset: 48, fromProgress: true })
  })

  it('falls back to the observed offset, flagged, when nothing lines up', () => {
    expect(proposePlacement(show('x'), [anime('mal', 2)], [])).toEqual({ traktSeason: 3, episodeOffset: 4, fromProgress: false })
    expect(proposePlacement(show('x'), [anime('mal', null)], [])).toEqual({ traktSeason: 3, episodeOffset: 0, fromProgress: false })
  })
})

describe('mapping store', () => {
  let db: Db
  beforeEach(() => {
    db = createDb(':memory:')
  })

  const trakt = (id: number, title: string, ids: Record<string, unknown> = {}, next = { season: 3, number: 6 }) => ({
    show: { title, year: 2021, ids: { trakt: id, slug: `t-${id}`, ...ids } },
    progress: { aired: 60, completed: 50, next_episode: next }
  })
  const simklAnime = (id: number, mal: number, extra: Record<string, unknown> = {}) => ({
    status: 'watching', next_to_watch: 'E6', watched_episodes_count: 5, total_episodes_count: 12, not_aired_episodes_count: 0,
    show: { title: `Simkl ${id}`, year: 2026, ids: { simkl: id, mal: String(mal), anilist: String(mal + 1000), ...extra } }
  })
  const malItem = (id: number, title = `Mal ${id}`) => ({
    node: { id, title, num_episodes: 12, media_type: 'tv' },
    list_status: { status: 'watching', num_episodes_watched: 5 }
  })

  function setup(lists: Parameters<typeof entriesFrom>[0]) {
    const { entries } = entriesFrom(lists)
    const store = createMappingStore(db)
    store.syncAutoLinks(entries, linkByIds(entries))
    return { entries, store }
  }

  it('stores a Simkl and MAL pair as an unplaced season of a new anime show', () => {
    setup({ simkl: { anime: [simklAnime(5, 50)] }, mal: { data: [malItem(50)] } })
    expect(db.select().from(mappings).all()).toMatchObject([{ kind: 'anime', status: 'auto', traktId: null }])
    expect(db.select().from(mappingSeasons).all()).toMatchObject([{ malId: 50, simklId: 5, anilistId: 1050, traktSeason: null, episodeCount: 12 }])
  })

  it('stores a Trakt link proven by IDs under the Trakt show, still unplaced', () => {
    setup({ trakt: [trakt(1, 'One Piece', { tmdb: 37854 })], simkl: { anime: [simklAnime(5, 50, { tmdb: '37854' })] }, mal: { data: [malItem(50)] } })
    expect(db.select().from(mappings).all()).toMatchObject([{ kind: 'anime', status: 'auto', traktId: 1, tmdbId: 37854 }])
    expect(db.select().from(mappingSeasons).all()).toMatchObject([{ malId: 50, simklId: 5, traktSeason: null }])
  })

  it('is idempotent', () => {
    const lists = { trakt: [trakt(1, 'One Piece', { tmdb: 37854 })], simkl: { anime: [simklAnime(5, 50, { tmdb: '37854' })] } }
    setup(lists)
    setup(lists)
    expect(db.select().from(mappings).all()).toHaveLength(1)
    expect(db.select().from(mappingSeasons).all()).toHaveLength(1)
  })

  it('proposes the ID-linked Trakt show first, placed from both next episodes', () => {
    const { entries, store } = setup({ trakt: [trakt(1, 'One Piece', { tmdb: 37854 })], simkl: { anime: [simklAnime(5, 50, { tmdb: '37854' })] } })
    expect(buildProposals(entries, {}, store)).toEqual([{
      animeKey: 'simkl:5',
      trakt: { trakt: 1, slug: 't-1', tmdb: 37854, title: 'One Piece', year: 2021, next: { season: 3, number: 6, title: null }, onList: true },
      via: 'ids',
      score: 1,
      placement: { traktSeason: 3, episodeOffset: 0, fromProgress: true },
      chain: []
    }])
  })

  it('proposes a Trakt show by title for an entry without shared IDs, and confirm places it', () => {
    const { entries, store } = setup({
      trakt: [trakt(1, 'Mushoku Tensei: Jobless Reincarnation'), trakt(2, 'Bleach')],
      simkl: { anime: [simklAnime(5, 50)] },
      mal: { data: [malItem(50, 'Mushoku Tensei III')] }
    })
    const chains = { 50: [
      { malId: 10, anilistId: 1, format: 'TV', episodes: 11, year: 2021, titles: ['Mushoku Tensei: Jobless Reincarnation'] },
      { malId: 50, anilistId: 2, format: 'TV', episodes: 12, year: 2026, titles: ['Mushoku Tensei III'] }
    ] }

    const [proposal] = buildProposals(entries, chains, store)
    expect(proposal).toMatchObject({ animeKey: 'mal:50', trakt: { trakt: 1 }, via: 'title', placement: { traktSeason: 3, episodeOffset: 0 } })

    store.confirm(traktRefFromEntry(entries.find(e => e.key === 'trakt:1')!), entries.find(e => e.key === 'mal:50')!, { traktSeason: 3, episodeOffset: 0 })

    expect(db.select().from(mappings).all()).toMatchObject([{ traktId: 1, traktSlug: 't-1', kind: 'anime', status: 'confirmed' }])
    expect(db.select().from(mappingSeasons).all()).toMatchObject([{ malId: 50, simklId: 5, traktSeason: 3, episodeOffset: 0 }])
    expect(buildProposals(entries, chains, store)).toEqual([])
  })

  it('never proposes a rejected pair again', () => {
    const { entries, store } = setup({ trakt: [trakt(1, 'Mushoku Tensei')], mal: { data: [malItem(50)] } })
    const chains = { 50: [{ malId: 50, anilistId: 2, format: 'TV', episodes: 12, year: 2021, titles: ['Mushoku Tensei'] }] }
    expect(buildProposals(entries, chains, store)).toHaveLength(1)
    store.reject(1, 50)
    expect(buildProposals(entries, chains, store)).toEqual([])
  })

  it('refuses to place two entries at the same Trakt season and offset', () => {
    const { entries, store } = setup({ trakt: [trakt(1, 'Show')], mal: { data: [malItem(50), malItem(51)] } })
    const show = traktRefFromEntry(entries.find(e => e.key === 'trakt:1')!)
    store.confirm(show, entries.find(e => e.key === 'mal:50')!, { traktSeason: 3, episodeOffset: 0 })
    expect(() => store.confirm(show, entries.find(e => e.key === 'mal:51')!, { traktSeason: 3, episodeOffset: 0 })).toThrow(MappingError)
  })

  it('refuses to move an entry from one Trakt show to another', () => {
    const { entries, store } = setup({ trakt: [trakt(1, 'A'), trakt(2, 'B')], mal: { data: [malItem(50)] } })
    store.confirm(traktRefFromEntry(entries.find(e => e.key === 'trakt:1')!), entries.find(e => e.key === 'mal:50')!, { traktSeason: 1, episodeOffset: 0 })
    expect(() => store.confirm(traktRefFromEntry(entries.find(e => e.key === 'trakt:2')!), entries.find(e => e.key === 'mal:50')!, { traktSeason: 1, episodeOffset: 0 }))
      .toThrow('already linked to another Trakt show')
  })

  const offList = traktRefFromShow({ trakt: 9, slug: 'smoking-behind', tmdb: 296286, title: 'Smoking Behind the Supermarket with You', year: 2026 })

  it('proposes a Trakt show found by ID even when it is not on your up-next list', () => {
    const { entries, store } = setup({ simkl: { anime: [simklAnime(5, 50)] }, mal: { data: [malItem(50)] } })
    const [proposal] = buildProposals(entries, {}, store, { byMal: new Map([[50, offList]]), byTrakt: new Map() })
    expect(proposal).toMatchObject({ animeKey: 'mal:50', trakt: { trakt: 9, onList: false }, via: 'ids', placement: { traktSeason: null, fromProgress: false } })
  })

  it('confirms an off-list Trakt show, storing its slug, and drops the empty Simkl/MAL-only show', () => {
    const { entries, store } = setup({ simkl: { anime: [simklAnime(5, 50)] }, mal: { data: [malItem(50)] } })
    store.confirm(offList, entries.find(e => e.key === 'mal:50')!, { traktSeason: 1, episodeOffset: 0 })
    expect(db.select().from(mappings).all()).toMatchObject([{ traktId: 9, traktSlug: 'smoking-behind', tmdbId: 296286, status: 'confirmed' }])
    expect(db.select().from(mappingSeasons).all()).toMatchObject([{ malId: 50, simklId: 5, traktSeason: 1 }])
  })

  it('skips an ID-found show you rejected and falls back to title matches', () => {
    const { entries, store } = setup({ mal: { data: [malItem(50)] } })
    store.reject(9, 50)
    expect(buildProposals(entries, {}, store, { byMal: new Map([[50, offList]]), byTrakt: new Map() })).toEqual([])
  })

  it('links a non-anime Simkl show to its Trakt show once, at show level', () => {
    const { entries, store } = setup({ simkl: { shows: [{ ...simklAnime(7, 70), show: { title: 'Show', ids: { simkl: 7, tmdb: '42' } } }] } })
    const show = entries.find(e => e.key === 'simkl:7')!
    store.linkShow(show, traktRefFromShow({ trakt: 11, slug: 'show', tmdb: 42, title: 'Show', year: 2020 }))
    store.linkShow(show, traktRefFromShow({ trakt: 11, slug: 'show', tmdb: 42, title: 'Show', year: 2020 }))
    expect(db.select().from(mappings).all()).toMatchObject([{ kind: 'show', status: 'auto', traktId: 11, traktSlug: 'show', simklId: 7, tmdbId: 42 }])
  })

  it('edits a placement, counting as a confirm, and refuses a clash', () => {
    const { entries, store } = setup({ trakt: [trakt(1, 'Show')], mal: { data: [malItem(50), malItem(51)] } })
    const show = traktRefFromEntry(entries.find(e => e.key === 'trakt:1')!)
    store.confirm(show, entries.find(e => e.key === 'mal:50')!, { traktSeason: 1, episodeOffset: 0 })
    store.confirm(show, entries.find(e => e.key === 'mal:51')!, { traktSeason: 2, episodeOffset: 0 })
    const [first] = db.select().from(mappingSeasons).all()

    store.editSeason(first!.id, { traktSeason: 1, episodeOffset: 12 })
    expect(db.select().from(mappingSeasons).all()[0]).toMatchObject({ traktSeason: 1, episodeOffset: 12 })
    expect(() => store.editSeason(first!.id, { traktSeason: 2, episodeOffset: 0 })).toThrow(MappingError)
  })

  it('unlinks an anime entry from its Trakt show and never re-links it by ID or proposal', () => {
    const lists = { trakt: [trakt(1, 'One Piece', { tmdb: 37854 })], simkl: { anime: [simklAnime(5, 50, { tmdb: '37854' })] } }
    const { entries, store } = setup(lists)
    const [season] = db.select().from(mappingSeasons).all()

    store.unlinkSeason(season!.id)

    expect(db.select().from(mappings).all()).toMatchObject([{ traktId: null, kind: 'anime' }])
    expect(db.select().from(mappingSeasons).all()).toMatchObject([{ malId: 50, traktSeason: null }])
    setup(lists)
    expect(db.select().from(mappings).all()).toMatchObject([{ traktId: null }])
    expect(buildProposals(entries, {}, store)).toEqual([])
  })

  it('links again by hand after an unlink', () => {
    const { entries, store } = setup({ trakt: [trakt(1, 'Show')], mal: { data: [malItem(50)] } })
    const show = traktRefFromEntry(entries.find(e => e.key === 'trakt:1')!)
    store.confirm(show, entries.find(e => e.key === 'mal:50')!, { traktSeason: 1, episodeOffset: 0 })
    store.unlinkSeason(db.select().from(mappingSeasons).get()!.id)
    expect(store.isRejected(1, 50)).toBe(true)

    store.confirm(show, entries.find(e => e.key === 'mal:50')!, { traktSeason: 1, episodeOffset: 0 })
    expect(store.isRejected(1, 50)).toBe(false)
    expect(db.select().from(mappings).all()).toMatchObject([{ traktId: 1, status: 'confirmed' }])
  })

  it('unlinks a show-level link without the ID match bringing it back, and restores it', () => {
    const lists = { trakt: [trakt(1, 'Show', { tmdb: 42 })], simkl: { shows: [{ ...simklAnime(7, 70), show: { title: 'Show', ids: { simkl: 7, tmdb: '42' } } }] } }
    setup(lists)
    const store = createMappingStore(db)
    const [m] = db.select().from(mappings).all()
    expect(m).toMatchObject({ kind: 'show', status: 'auto' })

    store.setShowLinked(m!.id, false)
    setup(lists)
    expect(db.select().from(mappings).all()).toMatchObject([{ status: 'rejected' }])

    store.setShowLinked(m!.id, true)
    expect(db.select().from(mappings).all()).toMatchObject([{ status: 'auto' }])
  })

  it('never links or proposes specials, OVAs and movies (decision #23)', () => {
    const ova = { ...malItem(50), node: { ...malItem(50).node, media_type: 'ova' } }
    const { entries, store } = setup({ trakt: [trakt(1, 'Mal 50')], mal: { data: [ova] } })
    const chains = { 50: [{ malId: 50, anilistId: 2, format: 'OVA', episodes: 2, year: 2021, titles: ['Mal 50'] }] }
    expect(buildProposals(entries, chains, store)).toEqual([])
  })
})
