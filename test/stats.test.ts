import { describe, expect, it } from 'vitest'
import { createMalAdapter } from '../server/adapters/mal'
import { createSimklAdapter } from '../server/adapters/simkl'
import { createTraktAdapter } from '../server/adapters/trakt'
import { createDb } from '../server/db'
import { writeLog } from '../server/db/schema'
import { createDemoSources } from '../server/demo/fake-sources'
import { readMal, readSimkl, readTrakt, summarize, writeStats } from '../server/lib/stats'
import { createSourceWrapper } from '../server/lib/source-wrapper'
import { USER_ID } from '../server/lib/user'

const values = (figs: { label: string, value: number }[]) => Object.fromEntries(figs.map(f => [f.label, f.value]))

describe('stats readers', () => {
  it('reads the Trakt counts, with the 1 to 10 rating counts', () => {
    const r = readTrakt({ shows_watched: 332, show_plays: 16875, ratings: { total: 806, distribution: { 1: 18, 10: 215 } } })
    expect(values(r.headline)).toEqual({ 'Shows watched': 332, 'Show plays': 16875 })
    expect(values(r.more)).toEqual({ 'Ratings given': 806 })
    expect(r.ratings).toEqual([18, 0, 0, 0, 0, 0, 0, 0, 0, 215])
    expect(readTrakt({}).ratings).toBeNull()
  })

  it('reads Simkl stats as a split per list, leaving out what is missing instead of showing 0', () => {
    const r = readSimkl({ total_mins: 78230, tv: { total_mins: 35000, watching: { count: 4, left_to_watch_episodes: 12 }, completed: { count: 9 } }, watched_last_week: { total_mins: 320 } })
    expect(values(r.headline)).toEqual({ 'Time watched': 78230, 'Last week': 320 })
    expect(r.breakdowns).toEqual([{ title: 'TV', parts: [{ key: 'watching', label: 'Watching', value: 4 }, { key: 'completed', label: 'Completed', value: 9 }] }])
    expect(values(r.more)).toEqual({ 'Time on TV': 35000, 'Episodes left in Watching': 12 })
  })

  it('reads MAL anime statistics with the same status keys as Simkl', () => {
    const r = readMal({ anime_statistics: { num_items_watching: 3, num_items_completed: 40, num_items_on_hold: 1, num_days_watched: 20.5, num_episodes: 900, mean_score: 7.8 } })
    expect(values(r.headline)).toEqual({ 'Days watched': 20.5, 'Episodes': 900, 'Mean score': 7.8 })
    expect(r.breakdowns[0]!.parts.map(p => [p.key, p.value])).toEqual([['watching', 3], ['completed', 40], ['hold', 1]])
  })

  it('keeps only the statistics part of MAL\'s answer', () => {
    const res = { source: 'mal' as const, status: 'ok' as const, data: { name: 'someone', picture: 'x', anime_statistics: { num_episodes: 1 } }, fetchedAt: new Date(), retryAfter: null, stale: false }
    expect(summarize('mal', res).raw).toEqual({ num_episodes: 1 })
  })

  it('reads all three through the adapters in demo mode, looking up the Simkl account once', async () => {
    const db = createDb(':memory:')
    const sources = createDemoSources()
    const wrapper = createSourceWrapper({ db, sleep: async () => {} })
    const opts = { wrapper, oauth: { getAccessToken: async () => ({ ok: true as const, token: 'demo' }) }, env: { TRAKT_CLIENT_ID: 'demo', SIMKL_CLIENT_ID: 'demo', SIMKL_CLIENT_SECRET: 'demo' } as NodeJS.ProcessEnv, fetch: sources.fetch }
    const trakt = await createTraktAdapter(opts).fetchStats()
    const simkl = createSimklAdapter(opts)
    const mal = await createMalAdapter(opts).fetchStats()
    // Trakt's stats endpoint answers 204, so the figures are counted from the watched list (two pages of 25)
    // and the ratings, leaving out movies.
    expect(trakt.data).toMatchObject({ shows_watched: 37, show_plays: 37 * 50 + 666, ratings: { total: 22 } })
    expect(summarize('trakt', trakt).ratings).toEqual([0, 0, 0, 1, 2, 3, 5, 6, 3, 2])
    expect(summarize('trakt', trakt).note).toContain('shows only')
    expect(summarize('mal', mal).breakdowns[0]!.parts).toHaveLength(5)
    expect(summarize('simkl', await simkl.fetchStats()).breakdowns.map(b => b.title)).toEqual(['TV', 'Anime', 'Movies'])
    expect(wrapper.readCache('simkl', 'account_id')).toBe(4242)
    // The lists are read by the slug from /users/settings.
    expect(wrapper.readCache('trakt', 'user_slug')).toBe('demo')
  })
})

describe('write stats', () => {
  it('counts marks the sources took, per source and window', () => {
    const db = createDb(':memory:')
    const now = Date.UTC(2026, 9, 9)
    const DAY = 24 * 60 * 60 * 1000
    const add = (source: 'trakt' | 'simkl' | 'mal', daysAgo: number, result: 'ok' | 'error' = 'ok') =>
      db.insert(writeLog).values({ userId: USER_ID, source, action: 'mark_watched', item: {}, result, error: null, at: new Date(now - daysAgo * DAY) }).run()
    add('trakt', 1)
    add('trakt', 10)
    add('trakt', 200)
    add('mal', 2, 'error')
    expect(writeStats(db, now)).toEqual([
      { source: 'trakt', week: 1, month: 2, year: 3, failed: 0 },
      { source: 'simkl', week: 0, month: 0, year: 0, failed: 0 },
      { source: 'mal', week: 0, month: 0, year: 0, failed: 1 }
    ])
  })
})
