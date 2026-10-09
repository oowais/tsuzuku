import { beforeEach, describe, expect, it } from 'vitest'
import { createAniListAdapter } from '../server/adapters/anilist'
import { createMalAdapter } from '../server/adapters/mal'
import { createSimklAdapter } from '../server/adapters/simkl'
import { createTraktAdapter } from '../server/adapters/trakt'
import { createDb, type Db } from '../server/db'
import { sourceAccounts, writeLog } from '../server/db/schema'
import { createDemoSources } from '../server/demo/fake-sources'
import { createAcceptedStore } from '../server/lib/accepted-store'
import { assertDemoAllowed, isDemo } from '../server/demo/mode'
import { seedDemo } from '../server/demo/seed'
import { entriesFrom } from '../server/lib/entries'
import { buildProposals, createMappingStore, traktRefFromEntry } from '../server/lib/mapping-store'
import { seasonChains } from '../server/lib/seasons'
import { createSourceWrapper } from '../server/lib/source-wrapper'
import { explainDifference } from '../server/lib/diff-reasons'
import { placementFor, previousLinked, sequelsOf, startable, storedFor } from '../server/lib/next-season'
import type { Entry } from '../server/lib/entries'
import { buildUpNext } from '../server/lib/up-next'

// Demo mode runs the real adapters, parsing, mapping and Up Next code on the fixtures. These tests keep the
// fixtures in step with that code, and check that the demo shows every case it promises.

let db: Db
let t: number
let sources: ReturnType<typeof createDemoSources>

function setup(fail: Parameters<typeof createDemoSources>[0]['fail'] = []) {
  db = createDb(':memory:')
  t = Date.UTC(2026, 9, 9, 12)
  sources = createDemoSources({ now: () => t, fail })
  const wrapper = createSourceWrapper({ db, now: () => t, sleep: async (ms) => {
    t += ms
  } })
  const opts = { wrapper, oauth: { getAccessToken: async () => ({ ok: true as const, token: 'demo' }) }, env: { TRAKT_CLIENT_ID: 'demo', SIMKL_CLIENT_ID: 'demo', SIMKL_CLIENT_SECRET: 'demo' } as NodeJS.ProcessEnv, fetch: sources.fetch }
  seedDemo(db, wrapper, sources)
  return {
    trakt: createTraktAdapter(opts),
    simkl: createSimklAdapter(opts),
    mal: createMalAdapter(opts),
    anilist: createAniListAdapter({ db, wrapper, fetch: sources.fetch, now: () => t })
  }
}

async function load(a: ReturnType<typeof setup>) {
  const [trakt, simkl, mal] = await Promise.all([a.trakt.fetchUpNext(), a.simkl.fetchWatching(), a.mal.fetchWatching()])
  const { entries, errors } = entriesFrom({ trakt: trakt.data, simkl: simkl.data, mal: mal.data })
  const flags = { trakt: { stale: trakt.stale, blocked: trakt.status === 'rate_limited' }, simkl: { stale: simkl.stale, blocked: simkl.status === 'rate_limited' }, mal: { stale: mal.stale, blocked: mal.status === 'rate_limited' } }
  const store = createMappingStore(db)
  const rows = buildUpNext({ entries, mappings: store.all(), traktTitles: { 900008: 'Starling Tide' }, flags, accepted: createAcceptedStore(db).all() })
  return { entries, errors, rows, store, results: { trakt, simkl, mal } }
}

describe('demo mode', () => {
  beforeEach(() => {
    delete process.env.TSUZUKU_DEMO
  })

  it('is off unless asked for, and refuses production', () => {
    expect(isDemo({})).toBe(false)
    expect(isDemo({ TSUZUKU_DEMO: '1' })).toBe(true)
    expect(() => assertDemoAllowed({ TSUZUKU_DEMO: '1', NODE_ENV: 'production' })).toThrow('production')
    expect(() => assertDemoAllowed({ TSUZUKU_DEMO: '1', NODE_ENV: 'development' })).not.toThrow()
  })

  it('never calls a real host', async () => {
    const { fetch } = createDemoSources()
    await expect(fetch('https://example.com/')).rejects.toThrow('does not call example.com')
  })

  it('reads every fixture through the real adapters and stores no token', async () => {
    const { errors, entries, results } = await load(setup())
    expect(errors).toEqual([])
    expect(Object.values(results).map(r => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(entries.filter(e => e.source === 'trakt')).toHaveLength(10)
    expect(db.select().from(sourceAccounts).all().every(a => a.accessTokenEnc === null && a.refreshTokenEnc === null)).toBe(true)
  })

  it('shows every Up Next case', async () => {
    const { rows } = await load(setup())
    const byTitle = (title: string) => rows.find(r => r.title === title)!
    const states = new Set(rows.flatMap(r => Object.values(r.cells).map(c => c!.state)))
    expect([...states].sort()).toEqual(['alone', 'caught_up', 'differs', 'in_sync', 'not_in_list', 'not_placed', 'unmapped'])

    expect(byTitle('Moonfall Academy')).toMatchObject({ section: 'trakt', kind: 'anime', agrees: true, cells: { mal: { traktNext: { season: 1, number: 17 } } } })
    expect(byTitle('Harbor Lights')).toMatchObject({ kind: 'show', agrees: true })
    expect(byTitle('Iron Petals')).toMatchObject({ differs: true, accepted: true })
    expect(byTitle('Paper Kites')).toMatchObject({ kind: 'show', differs: true, accepted: false })
    expect(byTitle('Lantern Road')).toMatchObject({ kind: 'anime', differs: true, accepted: false })
    expect(byTitle('Quiet Orbit')).toMatchObject({ kind: 'unknown', cells: { trakt: { state: 'alone' } } })
    expect(byTitle('Clockwork Garden').cells.simkl!.state).toBe('not_placed')
    expect(byTitle('I Was Reborn as the Lighthouse Keeper of a Forgotten Harbor Town, So I Opened a Tea Shop')).toMatchObject({ kind: 'anime', agrees: true })
    expect(byTitle('The Extraordinarily Long Afternoon of Professor Wilhelmina Ashcombe-Fairweather')).toMatchObject({ kind: 'show', differs: true, accepted: false })

    const other = rows.filter(r => r.section === 'other').map(r => r.title)
    expect(other.sort()).toEqual(['Birodo Suisei', 'Chronicles of the Northern Lighthouse Keepers and Their Remarkably Patient Cats', 'Haguruma no Guwa', 'Hinoko Monogatari', 'Mukudori no Shio', 'Winter Ledger'])
    const starling = rows.find(r => r.cells.simkl?.entry?.title === 'Starling Tide')!
    expect(starling.cells.trakt).toMatchObject({ state: 'not_in_list', ref: { title: 'Starling Tide' } })
    expect(Date.parse(starling.cells.simkl!.entry!.next!.airedAt!)).toBeGreaterThan(t)
    expect(rows.find(r => r.cells.mal?.entry?.format === 'ova')).toBeDefined()
    expect(rows.find(r => r.title === 'Birodo Suisei')).toMatchObject({ hasNext: false })
  })

  it('explains Paper Kites by the mark that reached Simkl only', async () => {
    const { rows } = await load(setup())
    const kites = rows.find(r => r.title === 'Paper Kites')!
    const writes = db.select().from(writeLog).all().filter(w => (w.item as { rowKey?: string }).rowKey === kites.key)
      .map(w => ({ source: w.source, at: w.at, markId: (w.item as { markId?: string }).markId ?? null, result: w.result }))
    expect(explainDifference(kites, { writes, chains: {}, now: t })).toMatchObject([{ kind: 'partial_mark', reached: ['simkl'], behind: 'trakt' }])
  })

  it('has a proposal to confirm and an anime only search can link', async () => {
    const a = setup()
    const { entries, store } = await load(a)
    const malIds = entries.filter(e => e.kind === 'anime' && e.ids.mal !== undefined).map(e => e.ids.mal!)
    const chains = await seasonChains(malIds, async ids => (await a.anilist.byMalIds(ids)).media)
    expect(chains[950032]!.map(s => s.malId)).toEqual([950031, 950032])
    const proposals = buildProposals(entries, chains, store)
    expect(proposals.map(p => p.trakt.title)).toEqual(['Clockwork Garden'])
    expect(store.isRejected(900011, { mal: 950101 })).toBe(true)
  })

  it('applies marks, so the next read shows them', async () => {
    const a = setup()
    await load(a)
    expect(await a.trakt.markWatched(900003, { season: 1, number: 17 }, new Date(t))).toMatchObject({ ok: true })
    expect(await a.simkl.markWatched('anime', 970032, { season: null, number: 5 }, new Date(t))).toMatchObject({ ok: true })
    expect(await a.mal.setWatched(950032, 5)).toMatchObject({ ok: true })
    t += 1000
    const { rows } = await load(a)
    const moonfall = rows.find(r => r.title === 'Moonfall Academy')!
    expect(moonfall.cells.trakt!.entry!.next).toMatchObject({ season: 1, number: 18 })
    expect(moonfall.cells.simkl!.entry!.next).toMatchObject({ number: 6 })
    expect(moonfall.cells.mal!.entry!.watched).toBe(5)
    expect(moonfall.agrees).toBe(true)
  })

  it('takes ratings: Trakt and Simkl in a call of their own, MAL with the mark (#65)', async () => {
    const a = setup()
    await load(a)
    expect(await a.trakt.showRating(900003)).toEqual({ rating: null })
    expect(await a.trakt.rateShow(900003, 9, new Date(t))).toMatchObject({ ok: true })
    expect(await a.trakt.showRating(900003)).toEqual({ rating: 9 })
    expect(await a.trakt.rateShow(1, 9, new Date(t))).toMatchObject({ ok: false })
    expect(await a.simkl.rate('anime', 970032, 7, new Date(t))).toMatchObject({ ok: true })
    expect(await a.simkl.rate('anime', 970032, 11, new Date(t))).toMatchObject({ ok: false })
    expect(await a.mal.setWatched(950032, 5, null, null, 8)).toMatchObject({ ok: true })
    t += 1000
    const moonfall = (await load(a)).rows.find(r => r.title === 'Moonfall Academy')!
    expect(moonfall.cells.simkl!.entry!.rating).toBe(7)
    expect(moonfall.cells.mal!.entry!.rating).toBe(8)
  })

  it('starts Glass Harbor season 2 from season 1\'s sequel, and links it to Trakt S2 (#66)', async () => {
    const a = setup()
    const { rows, store } = await load(a)
    const row = rows.find(r => r.title === 'Glass Harbor')!
    expect(startable(row)).toEqual({ sources: ['mal', 'simkl'], search: false })
    expect(startable(rows.find(r => r.title === 'Quiet Orbit')!)).toEqual({ sources: [], search: true })

    const seasons = store.all().find(m => `m:${m.id}` === row.key)!.seasons
    const at = { season: 2, number: 1 }
    expect(storedFor(seasons, at)).toBeNull()
    const prev = previousLinked(seasons, at)!
    expect(prev.malId).toBe(950141)
    const { media } = await a.anilist.byMalIds([950141])
    const [target] = sequelsOf(media[950141])
    expect(target).toMatchObject({ malId: 950142, title: 'Glass Harbor Season 2', format: 'TV' })
    expect(placementFor(at, [])).toEqual({ traktSeason: 2, episodeOffset: 0, linked: false })

    // Season 1 is completed on MAL, season 2 not on the list; starting it never sends a watched count.
    expect(await a.mal.listStatus(950141)).toMatchObject({ status: 'completed', watched: 12, startDate: '2025-07-02' })
    expect(await a.mal.listStatus(950142)).toEqual({ status: null, watched: null, startDate: null, finishDate: null })
    expect(await a.mal.startWatching(950142, '2026-10-09')).toMatchObject({ ok: true, listStatus: 'watching' })
    expect(await a.mal.listStatus(950142)).toMatchObject({ status: 'watching', watched: 0, startDate: '2026-10-09', finishDate: null })
    // Completing it later sets the finish date that goes with it.
    expect(await a.mal.setWatched(950142, 12, 'completed', '2026-12-24')).toMatchObject({ ok: true, listStatus: 'completed' })
    expect(await a.mal.listStatus(950142)).toMatchObject({ status: 'completed', finishDate: '2026-12-24', startDate: '2026-10-09' })
    await a.mal.startWatching(950142)
    expect(await a.simkl.addToWatching(950142)).toMatchObject({ ok: true })
    expect(await a.simkl.addToWatching(123)).toMatchObject({ ok: false, error: 'Simkl did not find this anime by its MAL ID' })
    store.confirm(traktRefFromEntry(row.cells.trakt!.entry!), { source: 'mal', kind: 'anime', ids: { mal: 950142, anilist: 960142 }, episodes: 12 } as Entry, { traktSeason: 2, episodeOffset: 0 })

    t += 1000
    const after = (await load(a)).rows.find(r => r.title === 'Glass Harbor')!
    expect(after.cells.mal).toMatchObject({ state: 'in_sync', traktNext: { season: 2, number: 1 } })
    expect(after.cells.simkl).toMatchObject({ state: 'in_sync', traktNext: { season: 2, number: 1 } })
    expect(after.agrees).toBe(true)
    expect(startable(after).sources).toEqual([])
  })

  it('serves the seeded lists as stale when a source is made to fail', async () => {
    const { results, rows } = await load(setup(['mal']))
    expect(results.mal).toMatchObject({ status: 'rate_limited', stale: true })
    expect(rows.find(r => r.title === 'Moonfall Academy')!.cells.mal).toMatchObject({ blocked: true })
  })
})
