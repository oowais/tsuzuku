import { describe, expect, it } from 'vitest'
import { createMalAdapter } from '../server/adapters/mal'
import { createSimklAdapter } from '../server/adapters/simkl'
import { createTraktAdapter } from '../server/adapters/trakt'
import { createDb } from '../server/db'
import { writeLog } from '../server/db/schema'
import { createDemoSources } from '../server/demo/fake-sources'
import { malGroups, simklGroups, summarize, traktGroups, writeStats } from '../server/lib/stats'
import { createSourceWrapper } from '../server/lib/source-wrapper'
import { USER_ID } from '../server/lib/user'

const labels = (groups: { title: string, figures: { label: string, value: number }[] }[]) =>
  Object.fromEntries(groups.map(g => [g.title, Object.fromEntries(g.figures.map(f => [f.label, f.value]))]))

describe('stats readers', () => {
  it('reads Trakt stats as documented', () => {
    const groups = traktGroups({ movies: { plays: 155, watched: 114, minutes: 15650 }, shows: { watched: 16 }, episodes: { plays: 552, watched: 534, minutes: 17330 }, ratings: { total: 389 } })
    expect(labels(groups)).toEqual({
      Shows: { 'Shows watched': 16, 'Episodes watched': 534, 'Episode plays': 552, 'Time watching episodes': 17330 },
      Movies: { 'Movies watched': 114, 'Time watching movies': 15650 },
      Ratings: { 'Ratings given': 389 }
    })
  })

  it('reads Simkl stats per list, and leaves out what is missing instead of showing 0', () => {
    const groups = simklGroups({ total_mins: 78230, tv: { total_mins: 35000, watching: { count: 4, left_to_watch_episodes: 12 }, completed: { count: 9 } }, watched_last_week: { total_mins: 320 } })
    expect(labels(groups)).toEqual({
      Overall: { 'Time watched': 78230, 'Last week': 320 },
      TV: { 'Time watched': 35000, 'Watching': 4, 'Completed': 9, 'Episodes left in Watching': 12 }
    })
  })

  it('reads MAL anime statistics', () => {
    const groups = malGroups({ anime_statistics: { num_items_watching: 3, num_items_completed: 40, num_days_watched: 20.5, num_episodes: 900, mean_score: 7.8 } })
    expect(labels(groups)).toEqual({ Anime: { 'Days watched': 20.5, 'Episodes': 900, 'Mean score': 7.8, 'Watching': 3, 'Completed': 40 } })
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
    expect(summarize('trakt', trakt).groups.length).toBeGreaterThan(0)
    expect(summarize('mal', mal).groups[0]!.figures.length).toBeGreaterThan(5)
    expect(summarize('simkl', await simkl.fetchStats()).groups.map(g => g.title)).toEqual(['Overall', 'TV', 'Anime', 'Movies'])
    expect(wrapper.readCache('simkl', 'account_id')).toBe(4242)
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
