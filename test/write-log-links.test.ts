import { describe, expect, it, vi } from 'vitest'
import { createDb } from '../server/db'
import { createWriteLog, logLinks } from '../server/lib/write-log'

const slugs = (id: number) => (id === 7 ? 'lantern-road' : undefined)

describe('write log links', () => {
  it('uses the link the mark stored', () => {
    const link = { target: { source: 'simkl' as const, kind: 'anime' as const, ids: { simkl: 5, simklSlug: 'mushoku' } }, episode: { season: null, number: 14 } }
    expect(logLinks('simkl', { link }, slugs)).toEqual({ url: 'https://simkl.com/anime/5/mushoku', episodeUrl: 'https://simkl.com/anime/5/mushoku/episode-14/' })
  })

  it('links older entries from the IDs in the write, with no source calls', () => {
    expect(logLinks('trakt', { write: { source: 'trakt', show: 7, season: 3, number: 14 } }, slugs))
      .toEqual({ url: 'https://trakt.tv/shows/lantern-road', episodeUrl: 'https://trakt.tv/shows/lantern-road/seasons/3/episodes/14' })
    expect(logLinks('mal', { write: { source: 'mal', mal: 39535, watched: 14, status: 'completed' } }, slugs))
      .toEqual({ url: 'https://myanimelist.net/anime/39535', episodeUrl: 'https://myanimelist.net/anime/39535/_/episode/14' })
    // Without a slug, Simkl's episode pages cannot be built: the item page instead.
    expect(logLinks('simkl', { write: { source: 'simkl', kind: 'show', simkl: 9, season: 1, number: 2 } }, slugs))
      .toEqual({ url: 'https://simkl.com/tv/9', episodeUrl: 'https://simkl.com/tv/9' })
  })

  it('has no link for a Trakt show you never linked, or a write without IDs', () => {
    expect(logLinks('trakt', { write: { source: 'trakt', show: 8, season: 1, number: 1 } }, slugs)).toEqual({ url: null, episodeUrl: null })
    expect(logLinks('mal', { write: null }, slugs)).toEqual({ url: null, episodeUrl: null })
  })
})

describe('write log lines (#92)', () => {
  it('puts each write in the docker log, failures as warnings', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const log = createWriteLog(createDb(':memory:'))
      const item = { rowKey: 'k', title: 'Frieren', episode: 'E12', summary: '', expected: '', write: {} }
      log.add('mal', 'mark_watched', item, null)
      log.add('trakt', 'mark_watched', item, 'HTTP 502')
      expect(info).toHaveBeenCalledWith('[write] mal mark_watched "Frieren" E12: ok')
      expect(warn).toHaveBeenCalledWith('[write] trakt mark_watched "Frieren" E12: failed: HTTP 502')
    } finally {
      info.mockRestore()
      warn.mockRestore()
    }
  })
})
