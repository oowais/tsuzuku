import { describe, expect, it } from 'vitest'
import { placementFor, previousLinked, sequelsOf, storedFor } from '../server/lib/next-season'
import type { ChainStep } from '../server/lib/seasons'

const season = (malId: number, traktSeason: number | null, episodeOffset: number, episodeCount: number | null = 12) => ({ malId, traktSeason, episodeOffset, episodeCount })
const step = (malId: number, episodes: number): ChainStep => ({ malId, anilistId: malId, format: 'TV', episodes, year: null, titles: [] })

describe('starting the next season', () => {
  it('uses a stored link that still covers Trakt\'s next episode', () => {
    const seasons = [season(1, 1, 0), season(2, 2, 0)]
    expect(storedFor(seasons, { season: 2, number: 1 })).toMatchObject({ malId: 2 })
    expect(storedFor(seasons, { season: 3, number: 1 })).toBeNull()
  })

  it('split cour in one long Trakt season: past the first cour, its sequel comes next at offset 12', () => {
    const seasons = [season(1, 1, 0, 12)]
    const at = { season: 1, number: 13 }
    expect(storedFor(seasons, at)).toBeNull()
    expect(previousLinked(seasons, at)).toMatchObject({ malId: 1 })
    expect(placementFor(at, [step(1, 12), step(2, 12)])).toEqual({ traktSeason: 1, episodeOffset: 12, linked: false })
  })

  it('a new Trakt season starts at offset 0, and odd gaps never set an offset the chain does not allow', () => {
    expect(placementFor({ season: 2, number: 1 }, [])).toEqual({ traktSeason: 2, episodeOffset: 0, linked: false })
    expect(placementFor({ season: 2, number: 3 }, [step(1, 12), step(2, 12)])).toMatchObject({ episodeOffset: 0 })
  })

  it('the latest linked entry before Trakt\'s position is the one whose sequel comes next', () => {
    const seasons = [season(1, 1, 0), season(2, 2, 0), season(3, null, 0)]
    expect(previousLinked(seasons, { season: 3, number: 1 })).toMatchObject({ malId: 2 })
  })

  it('follows only series SEQUEL edges: not side stories, recaps or one-off specials', () => {
    const node = (idMal: number | null, format: string, episodes: number | null) => ({ type: 'ANIME', idMal, format, episodes, id: 1, status: 'RELEASING', title: { english: `E${idMal}` }, startDate: { year: 2026 } })
    const media = {
      id: 1,
      idMal: 1,
      relations: { edges: [
        { relationType: 'SEQUEL', node: node(2, 'TV', 12) },
        { relationType: 'SEQUEL', node: node(3, 'MOVIE', 1) },
        { relationType: 'SEQUEL', node: node(4, 'ONA', 1) },
        { relationType: 'SIDE_STORY', node: node(5, 'TV', 12) },
        { relationType: 'SEQUEL', node: node(null, 'TV', 12) },
        { relationType: 'PREQUEL', node: node(6, 'TV', 12) }
      ] }
    }
    expect(sequelsOf(media).map(s => s.malId)).toEqual([2])
    expect(sequelsOf(null)).toEqual([])
  })
})
