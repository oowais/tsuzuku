import type { Db } from '../db'
import { mappings, mappingSeasons, writeLog } from '../db/schema'
import { createAcceptedStore } from '../lib/accepted-store'
import { entriesFrom } from '../lib/entries'
import { linkByIds } from '../lib/mapping'
import { createMappingStore, traktRefFromEntry, traktRefFromShow } from '../lib/mapping-store'
import type { createSourceWrapper } from '../lib/source-wrapper'
import { buildUpNext } from '../lib/up-next'
import { USER_ID } from '../lib/user'
import type { createDemoSources } from './fake-sources'
import { TRAKT_CATALOG } from './fixtures'

type Sources = ReturnType<typeof createDemoSources>

// Fills a demo database. The links, accepted difference, rejection and write log are created once, through
// the same store functions the app uses; the cached source answers are rewritten on every start so they
// match the fresh fake state (they are what a blocked source shows as stale). No token is ever stored.
export function seedDemo(db: Db, wrapper: ReturnType<typeof createSourceWrapper>, sources: Sources) {
  const { state } = sources
  wrapper.writeCache('trakt', 'up_next', state.trakt)
  wrapper.writeCache('simkl', 'watching', state.simkl)
  wrapper.writeCache('simkl', 'activities', state.activities)
  wrapper.writeCache('mal', 'watching', { data: state.mal.data })

  if (db.select().from(mappings).limit(1).get()) return

  const { entries } = entriesFrom({ trakt: state.trakt, simkl: state.simkl, mal: { data: state.mal.data } })
  const store = createMappingStore(db)
  const entry = (key: string) => {
    const e = entries.find(x => x.key === key)
    if (!e) throw new Error(`Demo fixture ${key} is missing`)
    return e
  }
  const traktEntry = (trakt: number) => traktRefFromEntry(entry(`trakt:${trakt}`))
  const catalogRef = (slug: string) => traktRefFromShow(TRAKT_CATALOG.find(s => s.slug === slug)!)

  // What the app links by shared IDs on its own.
  store.syncAutoLinks(entries, linkByIds(entries))

  // What you would have confirmed on /mappings. Clockwork Garden stays unplaced, so it shows as a proposal.
  store.confirm(traktEntry(900003), entry('mal:950032'), { traktSeason: 1, episodeOffset: 12 })
  store.confirm(traktEntry(900004), entry('mal:950041'), { traktSeason: 1, episodeOffset: 0 })
  store.confirm(traktEntry(900005), entry('mal:950051'), { traktSeason: 1, episodeOffset: 0 })
  store.confirm(traktEntry(900012), entry('mal:950121'), { traktSeason: 1, episodeOffset: 0 })
  store.confirm(catalogRef('starling-tide'), entry('mal:950081'), { traktSeason: 1, episodeOffset: 0 })
  // Glass Harbor season 1, linked while you watched it; completed since, so on no watching list now (#66).
  const glass = db.insert(mappings).values({ userId: USER_ID, traktId: 900014, traktSlug: 'glass-harbor', tmdbId: 990014, kind: 'anime', status: 'confirmed' }).returning().get()
  db.insert(mappingSeasons).values({ userId: USER_ID, mappingId: glass.id, traktSeason: 1, malId: 950141, anilistId: 960141, simklId: 970141, episodeOffset: 0, episodeCount: 12 }).run()
  // "Not this show": Ember Island is never proposed for Ember Saga again.
  store.reject(900011, { mal: 950101, simkl: 970101 })

  // MAL one behind on Iron Petals, accepted as it is now.
  const flags = { trakt: { stale: false, blocked: false }, simkl: { stale: false, blocked: false }, mal: { stale: false, blocked: false } }
  const rows = buildUpNext({ entries, mappings: store.all(), traktTitles: {}, flags })
  const iron = rows.find(r => r.title === 'Iron Petals')
  if (!iron?.differs) throw new Error('Demo fixture Iron Petals should differ')
  createAcceptedStore(db).accept(iron.key, iron.signature)

  // Earlier writes, one of them failed.
  const poster = (key: string, title: string) => `/_demo/poster?key=${encodeURIComponent(key)}&title=${encodeURIComponent(title)}`
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
  // With the write as sent, so the Log page can link each one.
  const log = (source: 'trakt' | 'simkl' | 'mal', title: string, episode: string, summary: string, hoursAgo: number, write: object, error: string | null = null) =>
    db.insert(writeLog).values({ userId: USER_ID, source, action: 'mark_watched', item: { rowKey: 'demo', title, episode, summary, expected: 'demo', write: { source, ...write }, images: [poster('demo', title)] }, result: error ? 'error' : 'ok', error, at: at(hoursAgo) }).run()
  log('trakt', 'Moonfall Academy', 'S1E16', 'Add S1E16 to history, watched now', 3, { show: 900003, season: 1, number: 16 })
  log('simkl', 'Moonfall Academy Part 2', 'E4', 'Add E4 to history, watched now', 3, { kind: 'anime', simkl: 970032, season: null, number: 4, status: null })
  log('mal', 'Getsuraku Gakuen Part 2', 'E4', 'Watched 3 → 4 of 12', 3, { mal: 950032, watched: 4, status: null })
  log('mal', 'Tetsu no Hanabira', 'E7', 'Watched 6 → 7 of 12', 26, { mal: 950041, watched: 7, status: null }, 'HTTP 503')

  // Paper Kites: a mark that reached Simkl only, so Up Next explains Trakt being one behind (#78).
  const kites = rows.find(r => r.title === 'Paper Kites')
  if (!kites) throw new Error('Demo fixture Paper Kites is missing')
  const markId = 'demo-paper-kites'
  for (const [source, error] of [['trakt', 'HTTP 502'], ['simkl', null]] as const) {
    db.insert(writeLog).values({ userId: USER_ID, source, action: 'mark_watched', item: { rowKey: kites.key, markId, title: 'Paper Kites', episode: 'S1E3', summary: 'Add S1E3 to history, watched now', expected: 'demo', images: [poster(kites.key, 'Paper Kites')], write: source === 'trakt' ? { source, show: 900002, season: 1, number: 3 } : { source, kind: 'show', simkl: 970002, season: 1, number: 3, status: null } }, result: error ? 'error' : 'ok', error, at: at(30) }).run()
  }
}
