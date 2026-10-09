import { describe, expect, it, vi } from 'vitest'
import { createAniListAdapter, nextAiring } from '../server/adapters/anilist'
import { createTraktPublic, toNextEpisode } from '../server/adapters/trakt-public'
import { createDb } from '../server/db'
import { createSourceWrapper } from '../server/lib/source-wrapper'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const HOUR = 60 * 60 * 1000

function setup() {
  const db = createDb(':memory:')
  let t = Date.UTC(2026, 9, 9, 12)
  const now = () => t
  const wrapper = createSourceWrapper({ db, now, sleep: async (ms) => {
    t += ms
  } })
  const fetch = vi.fn<typeof globalThis.fetch>()
  return { db, wrapper, fetch, now, advance: (ms: number) => (t += ms), at: () => t }
}

describe('next episode for caught-up rows (#62)', () => {
  it('reads Trakt\'s next episode, and none on a 204, asking again after a day', async () => {
    const s = setup()
    const trakt = createTraktPublic({ db: s.db, wrapper: s.wrapper, fetch: s.fetch, now: s.now, env: { TRAKT_CLIENT_ID: 'id' } as NodeJS.ProcessEnv })
    s.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await trakt.nextEpisode('ended-show')).data).toBeNull()
    expect((await trakt.nextEpisode('ended-show')).data).toBeNull()
    expect(s.fetch).toHaveBeenCalledTimes(1)
    s.advance(25 * HOUR)
    s.fetch.mockResolvedValueOnce(json({ season: 38, number: 3, title: 'The Kosmic Kruiser', first_aired: new Date(s.at() + 48 * HOUR).toISOString() }))
    expect((await trakt.nextEpisode('ended-show')).data).toMatchObject({ season: 38, number: 3, title: 'The Kosmic Kruiser' })
    expect(String(s.fetch.mock.calls[1]![0])).toContain('/shows/ended-show/next_episode?extended=full')
  })

  it('asks Trakt again as soon as the cached episode has aired', async () => {
    const s = setup()
    const trakt = createTraktPublic({ db: s.db, wrapper: s.wrapper, fetch: s.fetch, now: s.now, env: { TRAKT_CLIENT_ID: 'id' } as NodeJS.ProcessEnv })
    s.fetch.mockResolvedValue(json({ season: 1, number: 2, title: null, first_aired: new Date(s.at() + HOUR).toISOString() }))
    await trakt.nextEpisode(7)
    await trakt.nextEpisode(7)
    expect(s.fetch).toHaveBeenCalledTimes(1)
    s.advance(2 * HOUR)
    await trakt.nextEpisode(7)
    expect(s.fetch).toHaveBeenCalledTimes(2)
  })

  it('reads AniList\'s nextAiringEpisode, and refreshes a cached one once it has aired', async () => {
    const s = setup()
    const media = (airingAt: number | null) => json({ data: { Page: { pageInfo: { hasNextPage: false }, media: [{ id: 1, idMal: 21, nextAiringEpisode: airingAt === null ? null : { episode: 1181, airingAt } }] } } })
    s.fetch.mockResolvedValueOnce(media(Math.round((s.at() + HOUR) / 1000)))
    const anilist = createAniListAdapter({ db: s.db, wrapper: s.wrapper, fetch: s.fetch, now: s.now })
    expect(nextAiring((await anilist.byMalIds([21])).media[21])).toMatchObject({ episode: 1181 })
    await anilist.byMalIds([21])
    expect(s.fetch).toHaveBeenCalledTimes(1)
    s.advance(2 * HOUR)
    s.fetch.mockResolvedValueOnce(media(null))
    expect(nextAiring((await anilist.byMalIds([21])).media[21])).toBeNull()
    expect(s.fetch).toHaveBeenCalledTimes(2)
  })

  it('fetches again an AniList entry cached before nextAiringEpisode was asked for', async () => {
    const s = setup()
    const anilist = createAniListAdapter({ db: s.db, wrapper: s.wrapper, fetch: s.fetch, now: s.now })
    s.fetch.mockResolvedValueOnce(json({ data: { Page: { pageInfo: { hasNextPage: false }, media: [{ id: 1, idMal: 5 }] } } }))
    await anilist.byMalIds([5])
    s.fetch.mockResolvedValueOnce(json({ data: { Page: { pageInfo: { hasNextPage: false }, media: [{ id: 1, idMal: 5, nextAiringEpisode: null }] } } }))
    await anilist.byMalIds([5])
    await anilist.byMalIds([5])
    expect(s.fetch).toHaveBeenCalledTimes(2)
  })

  it('ignores answers without the fields it needs', () => {
    expect(toNextEpisode({ season: 1, number: 2 })).toBeNull()
    expect(nextAiring({ id: 1, idMal: 1, nextAiringEpisode: { episode: 'x' } })).toBeNull()
  })
})
