import { describe, expect, it } from 'vitest'
import { entriesFrom, malEntry, parseSimklEpisode, simklEntry, traktEntry, type Entry } from '../server/lib/entries'
import { linkByIds } from '../server/lib/mapping'

// Shapes as seen in the real responses (docs/context.md), with made-up values.
const trakt = (id: number, ids: Record<string, unknown> = {}) => ({
  show: { title: `Show ${id}`, year: 2020, ids: { trakt: id, slug: `show-${id}`, ...ids } },
  progress: {
    aired: 12,
    completed: 5,
    last_watched_at: '2026-10-01T10:00:00.000Z',
    next_episode: { season: 2, number: 6, title: 'Next one' }
  }
})

const simkl = (id: number, ids: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  status: 'watching',
  last_watched_at: '2026-09-01T10:00:00Z',
  next_to_watch: 'S02E06',
  watched_episodes_count: 5,
  total_episodes_count: 14,
  not_aired_episodes_count: 2,
  show: { title: `Simkl ${id}`, year: 2021, ids: { simkl: id, slug: `s-${id}`, ...ids } },
  ...extra
})

const mal = (id: number, watched = 3, episodes = 12) => ({
  node: {
    id,
    title: `Mal ${id}`,
    num_episodes: episodes,
    media_type: 'tv',
    alternative_titles: { en: `Mal ${id} EN`, ja: 'ジャ', synonyms: ['Syn'] },
    start_season: { year: 2024, season: 'fall' },
    start_date: '2024-10-04'
  },
  list_status: { status: 'watching', num_episodes_watched: watched, updated_at: '2026-08-01T00:00:00+00:00' }
})

describe('entries', () => {
  it('reads a Trakt up_next item', () => {
    expect(traktEntry(trakt(7, { tmdb: 100, tvdb: 200, imdb: 'tt1' }))).toEqual({
      source: 'trakt',
      key: 'trakt:7',
      kind: 'show',
      format: null,
      title: 'Show 7',
      altTitles: [],
      year: 2020,
      ids: { trakt: 7, traktSlug: 'show-7', tmdb: 100, tvdb: 200, imdb: 'tt1' },
      watched: 5,
      episodes: 12,
      next: { season: 2, number: 6, title: 'Next one' },
      lastActivityAt: '2026-10-01T10:00:00.000Z'
    })
  })

  it('reads a Simkl item, turning string IDs into numbers and counting aired episodes', () => {
    const e = simklEntry(simkl(9, { mal: '21', anilist: '22', tmdb: '100', traktslug: 'show-7' }, {
      anime_type: 'tv',
      next_to_watch: 'E6',
      next_to_watch_info: { title: 'Ep title', episode: 6, date: '2026-10-10' }
    }), 'anime')
    expect(e).toMatchObject({
      key: 'simkl:9',
      kind: 'anime',
      format: 'tv',
      ids: { simkl: 9, mal: 21, anilist: 22, tmdb: 100, traktSlug: 'show-7' },
      watched: 5,
      episodes: 12,
      next: { season: null, number: 6, title: 'Ep title' }
    })
  })

  it('has no next episode for a caught-up Simkl item', () => {
    expect(simklEntry(simkl(9, {}, { next_to_watch: null }), 'show').next).toBeNull()
  })

  it('parses Simkl episode labels', () => {
    expect(parseSimklEpisode('S01E05')).toEqual({ season: 1, number: 5 })
    expect(parseSimklEpisode('E1177')).toEqual({ season: null, number: 1177 })
    expect(parseSimklEpisode(null)).toBeNull()
    expect(parseSimklEpisode('soon')).toBeNull()
  })

  it('reads a MAL item, with the next episode as watched + 1', () => {
    expect(malEntry(mal(5))).toMatchObject({
      key: 'mal:5',
      kind: 'anime',
      format: 'tv',
      title: 'Mal 5',
      altTitles: ['Mal 5 EN', 'ジャ', 'Syn'],
      year: 2024,
      ids: { mal: 5 },
      watched: 3,
      episodes: 12,
      next: { season: null, number: 4, title: null },
      lastActivityAt: '2026-08-01T00:00:00+00:00'
    })
  })

  it('treats MAL 0 episodes as unknown and stops at the last episode', () => {
    expect(malEntry(mal(5, 30, 0))).toMatchObject({ episodes: null, next: { number: 31 } })
    expect(malEntry(mal(5, 12, 12)).next).toBeNull()
  })

  it('skips an unreadable item and reports it, keeping the rest', () => {
    const { entries, errors } = entriesFrom({
      trakt: [trakt(1), { show: { ids: {} } }],
      simkl: { shows: [simkl(2)], anime: [simkl(3)] },
      mal: { data: [mal(4)] }
    })
    expect(entries.map(e => e.key)).toEqual(['trakt:1', 'simkl:2', 'simkl:3', 'mal:4'])
    expect(errors).toEqual([{ source: 'trakt', error: 'Trakt item without show.ids.trakt' }])
  })
})

describe('linkByIds', () => {
  const entries = (lists: Parameters<typeof entriesFrom>[0]): Entry[] => entriesFrom(lists).entries

  it('links Trakt, Simkl and MAL through shared TMDB and MAL IDs', () => {
    const groups = linkByIds(entries({
      trakt: [trakt(1, { tmdb: 100 })],
      simkl: { anime: [simkl(2, { tmdb: '100', mal: '21' })] },
      mal: { data: [mal(21)] }
    }))
    expect(groups).toEqual([{ keys: ['trakt:1', 'simkl:2', 'mal:21'], via: ['mal', 'tmdb'] }])
  })

  it('links a Simkl item to Trakt through Simkl\'s traktslug', () => {
    const groups = linkByIds(entries({ trakt: [trakt(1)], simkl: { anime: [simkl(2, { traktslug: 'show-1' })] } }))
    expect(groups).toEqual([{ keys: ['trakt:1', 'simkl:2'], via: ['traktSlug'] }])
  })

  it('leaves entries without a shared ID unlinked', () => {
    expect(linkByIds(entries({ trakt: [trakt(1, { tmdb: 100 })], simkl: { shows: [simkl(2, { tmdb: '101' })] } }))).toEqual([])
  })

  it('flags a group with two entries from one source instead of linking it', () => {
    const groups = linkByIds(entries({
      trakt: [trakt(1, { tmdb: 100 })],
      simkl: { anime: [simkl(2, { tmdb: '100' }), simkl(3, { tmdb: '100' })] }
    }))
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ keys: ['trakt:1', 'simkl:2', 'simkl:3'], conflict: 'More than one simkl entry shares an ID' })
  })
})
