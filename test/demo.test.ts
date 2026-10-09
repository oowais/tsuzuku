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
import { buildProposals, createMappingStore } from '../server/lib/mapping-store'
import { seasonChains } from '../server/lib/seasons'
import { createSourceWrapper } from '../server/lib/source-wrapper'
import { explainDifference } from '../server/lib/diff-reasons'
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
    expect(entries.filter(e => e.source === 'trakt')).toHaveLength(9)
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

  it('serves the seeded lists as stale when a source is made to fail', async () => {
    const { results, rows } = await load(setup(['mal']))
    expect(results.mal).toMatchObject({ status: 'rate_limited', stale: true })
    expect(rows.find(r => r.title === 'Moonfall Academy')!.cells.mal).toMatchObject({ blocked: true })
  })
})
