import { describe, expect, it } from 'vitest'
import { episodeLabel, episodeUrl, itemUrl, seasonUrl, type LinkTarget } from '../shared/utils/source-links'

const trakt: LinkTarget = { source: 'trakt', kind: 'show', ids: { traktSlug: 'one-piece' } }
const simklAnime: LinkTarget = { source: 'simkl', kind: 'anime', ids: { simkl: 38636, simklSlug: 'one-piece' } }
const simklShow: LinkTarget = { source: 'simkl', kind: 'show', ids: { simkl: 4921, simklSlug: 'black-mirror' } }
const mal: LinkTarget = { source: 'mal', kind: 'anime', ids: { mal: 21 } }

describe('source links', () => {
  it('links show pages', () => {
    expect(itemUrl(trakt)).toBe('https://trakt.tv/shows/one-piece')
    expect(itemUrl(simklAnime)).toBe('https://simkl.com/anime/38636/one-piece')
    expect(itemUrl(simklShow)).toBe('https://simkl.com/tv/4921/black-mirror')
    expect(itemUrl(mal)).toBe('https://myanimelist.net/anime/21')
  })

  it('links seasons on Trakt and falls back to the show elsewhere', () => {
    expect(seasonUrl(trakt, 23)).toBe('https://trakt.tv/shows/one-piece/seasons/23')
    expect(seasonUrl(mal, 2)).toBe('https://myanimelist.net/anime/21')
  })

  it('links episodes in each source format', () => {
    expect(episodeUrl(trakt, { season: 23, number: 1177 })).toBe('https://trakt.tv/shows/one-piece/seasons/23/episodes/1177')
    expect(episodeUrl(simklAnime, { season: null, number: 1177 })).toBe('https://simkl.com/anime/38636/one-piece/episode-1177/')
    expect(episodeUrl(simklShow, { season: 2, number: 3 })).toBe('https://simkl.com/tv/4921/black-mirror/season-2/episode-3/')
    expect(episodeUrl(mal, { season: null, number: 1177 })).toBe('https://myanimelist.net/anime/21/_/episode/1177')
  })

  it('falls back to the show page when an episode link cannot be built', () => {
    expect(episodeUrl({ ...simklAnime, ids: { simkl: 38636 } }, { season: null, number: 5 })).toBe('https://simkl.com/anime/38636')
    expect(episodeUrl(trakt, { season: null, number: 5 })).toBe('https://trakt.tv/shows/one-piece')
    expect(itemUrl({ source: 'trakt', kind: 'show', ids: {} })).toBeNull()
  })

  it('labels episodes', () => {
    expect(episodeLabel({ season: 3, number: 6 })).toBe('S3E6')
    expect(episodeLabel({ season: null, number: 6 })).toBe('E6')
    expect(episodeLabel(null)).toBe('caught up')
  })
})
