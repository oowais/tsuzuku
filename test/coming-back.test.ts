import { describe, expect, it } from 'vitest'
import { comingBack, stageOf, ttlFor } from '../server/lib/coming-back'
import type { AniListMedia } from '../server/adapters/anilist'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const inDays = (d: number) => Math.round((NOW + d * DAY) / 1000)

const node = (idMal: number, extra: Record<string, unknown> = {}) => ({ id: idMal + 1000, idMal, type: 'ANIME', format: 'TV', episodes: 12, status: 'NOT_YET_RELEASED', title: { romaji: `R${idMal}`, english: `E${idMal}` }, startDate: { year: 2027, month: null, day: null }, nextAiringEpisode: null, ...extra })
const media = (idMal: number, edges: { relationType: string, node: ReturnType<typeof node> }[] = []): AniListMedia => ({ id: idMal + 1000, idMal, title: { romaji: `R${idMal}`, english: `E${idMal}` }, relations: { edges } })
const sequel = (n: ReturnType<typeof node>) => ({ relationType: 'SEQUEL', node: n })

describe('coming back', () => {
  it('shows an announced sequel with its partial date, from the completed entry', () => {
    const out = comingBack({ statuses: { 1: 'completed' }, media: { 1: media(1, [sequel(node(2))]) }, now: NOW })
    expect(out).toEqual([{
      malId: 2, anilistId: 1002, title: 'E2', format: 'TV', stage: 'announced', startDate: { year: 2027, month: null, day: null },
      nextEpisode: null, from: { malId: 1, title: 'E1' }, onPlanToWatch: false, cover: null
    }])
  })

  it('carries the sequel\'s AniList cover for its card', () => {
    const out = comingBack({ statuses: { 1: 'completed' }, media: { 1: media(1, [sequel(node(2, { coverImage: { medium: 'https://s4.anilist.co/x.jpg' } }))]) }, now: NOW })
    expect(out[0]!.cover).toBe('https://s4.anilist.co/x.jpg')
  })

  it('tells announced, scheduled and airing apart, and orders them airing first', () => {
    const out = comingBack({
      statuses: { 1: 'completed', 11: 'completed', 21: 'completed', 31: 'completed' },
      media: {
        1: media(1, [sequel(node(2))]),
        11: media(11, [sequel(node(12, { nextAiringEpisode: { episode: 1, airingAt: inDays(10) } }))]),
        21: media(21, [sequel(node(22, { status: 'RELEASING', nextAiringEpisode: { episode: 3, airingAt: inDays(2) } }))]),
        31: media(31, [sequel(node(32, { status: 'FINISHED' }))])
      },
      now: NOW
    })
    expect(out.map(s => [s.malId, s.stage])).toEqual([[22, 'airing'], [12, 'scheduled'], [2, 'announced'], [32, 'released']])
    expect(out[1]!.nextEpisode).toEqual({ episode: 1, airingAt: inDays(10) })
  })

  it('only follows sequels of a real format, with a MAL ID, that are not cancelled', () => {
    const edges = [
      { relationType: 'SIDE_STORY', node: node(2) },
      { relationType: 'ADAPTATION', node: node(3) },
      sequel(node(4, { format: 'SPECIAL' })),
      sequel(node(5, { format: 'OVA' })),
      sequel({ ...node(6), idMal: null as unknown as number }),
      sequel(node(7, { status: 'CANCELLED' })),
      sequel(node(8, { format: 'MOVIE' }))
    ]
    expect(comingBack({ statuses: { 1: 'completed' }, media: { 1: media(1, edges) }, now: NOW }).map(s => s.malId)).toEqual([8])
  })

  it('follows a completed sequel on to the newest season, and shows that one from it', () => {
    const out = comingBack({
      statuses: { 1: 'completed', 2: 'completed' },
      media: { 1: media(1, [sequel(node(2, { status: 'FINISHED' }))]), 2: media(2, [sequel(node(3))]) },
      now: NOW
    })
    expect(out).toMatchObject([{ malId: 3, from: { malId: 2, title: 'E2' } }])
  })

  it('leaves out sequels already on a watching list; Plan to Watch stays, with a badge', () => {
    const edges = [sequel(node(2)), sequel(node(3)), sequel(node(4)), sequel(node(5)), sequel(node(6))]
    const out = comingBack({ statuses: { 1: 'completed', 2: 'watching', 3: 'on_hold', 4: 'dropped', 5: 'plan_to_watch' }, media: { 1: media(1, edges) }, now: NOW })
    expect(out.map(s => [s.malId, s.onPlanToWatch])).toEqual([[5, true], [6, false]])
  })

  it('lists a sequel once when two completed entries lead to it, and survives a loop', () => {
    const out = comingBack({
      statuses: { 1: 'completed', 2: 'completed', 3: 'completed' },
      media: { 1: media(1, [sequel(node(3, { status: 'FINISHED' }))]), 2: media(2, [sequel(node(9))]), 3: media(3, [sequel(node(9)), sequel(node(1, { status: 'FINISHED' }))]) },
      now: NOW
    })
    expect(out.map(s => s.malId)).toEqual([9])
  })

  it('skips a completed entry AniList has nothing for', () => {
    expect(comingBack({ statuses: { 1: 'completed' }, media: { 1: null }, now: NOW })).toEqual([])
    expect(comingBack({ statuses: { 1: 'completed' }, media: {}, now: NOW })).toEqual([])
  })

  it('puts an announced sequel by its date, unknown dates last', () => {
    const edges = [sequel(node(2, { startDate: { year: null, month: null, day: null } })), sequel(node(3, { startDate: { year: 2028, month: 4, day: null } })), sequel(node(4, { startDate: { year: 2027, month: 10, day: 5 } }))]
    expect(comingBack({ statuses: { 1: 'completed' }, media: { 1: media(1, edges) }, now: NOW }).map(s => s.malId)).toEqual([4, 3, 2])
  })
})

describe('sequel stage and freshness', () => {
  it('calls a past or missing premiere announced, and a hiatus one announced too', () => {
    expect(stageOf(node(2, { nextAiringEpisode: { episode: 1, airingAt: inDays(-1) } }), NOW)?.stage).toBe('announced')
    expect(stageOf(node(2, { status: 'HIATUS' }), NOW)?.stage).toBe('announced')
    expect(stageOf(node(2, { status: 'CANCELLED' }), NOW)).toBeNull()
  })

  it('keeps an entry by what its sequels are doing', () => {
    expect(ttlFor(media(1), NOW)).toBe(30 * DAY)
    expect(ttlFor(media(1, [sequel(node(2))]), NOW)).toBe(7 * DAY)
    expect(ttlFor(media(1, [sequel(node(2)), sequel(node(3, { nextAiringEpisode: { episode: 1, airingAt: inDays(3) } }))]), NOW)).toBe(DAY)
    expect(ttlFor(media(1, [sequel(node(2, { status: 'RELEASING', nextAiringEpisode: { episode: 4, airingAt: inDays(1) } }))]), NOW)).toBe(DAY)
    // Only a finished sequel: nothing left to change, so as slow as no sequel at all.
    expect(ttlFor(media(1, [sequel(node(2, { status: 'FINISHED' }))]), NOW)).toBe(30 * DAY)
    // A finished one next to an announced one still follows the announced one.
    expect(ttlFor(media(1, [sequel(node(2, { status: 'FINISHED' })), sequel(node(3))]), NOW)).toBe(7 * DAY)
    expect(ttlFor(null, NOW)).toBe(30 * DAY)
  })
})
