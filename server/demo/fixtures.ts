// Fictional shows and anime for demo mode, as raw source answers shaped like the real ones
// (docs/context.md). Titles and IDs are made up; IDs sit in ranges real lists here do not use.
//
// What each one shows on Up Next (Trakt numbering):
// - Moonfall Academy: anime split into two cours on Simkl and MAL, one long Trakt season (offset 12); all agree.
// - Harbor Lights: a show linked by IDs; Trakt and Simkl agree.
// - Iron Petals: MAL one episode behind; that difference is accepted.
// - Paper Kites: a show where Simkl is one ahead; differs.
// - Lantern Road: anime where Simkl is one ahead; differs.
// - Quiet Orbit: only on Trakt, linked to nothing.
// - Clockwork Garden: linked by IDs, Trakt season not set yet (a proposal on /mappings).
// Not in Trakt up next:
// - Starling Tide: linked to a Trakt show that is not on your up-next list; next episode airs in 3 days.
// - Winter Ledger: a Simkl show with no IDs to link by.
// - Ember Saga: an anime nothing matches; "Link to Trakt" search finds it.
// - Fable of Gears: an OVA on MAL only (shown, never linked).
// - Velvet Comet: caught up everywhere.

const DAY = 24 * 60 * 60 * 1000

// Constant, so Simkl's activities check behaves the same after a restart; marks move it forward.
export const DEMO_ACTIVITIES_AT = '2026-01-01T00:00:00Z'

export interface TraktCatalogShow {
  trakt: number
  slug: string
  title: string
  year: number
  tmdb: number
  status: string
  seasons: { number: number, title: string | null, episodes: number }[]
}

export const TRAKT_CATALOG: TraktCatalogShow[] = [
  { trakt: 900001, slug: 'harbor-lights', title: 'Harbor Lights', year: 2024, tmdb: 990001, status: 'returning series', seasons: [{ number: 1, title: 'Season 1', episodes: 10 }, { number: 2, title: 'Season 2', episodes: 10 }] },
  { trakt: 900002, slug: 'paper-kites', title: 'Paper Kites', year: 2025, tmdb: 990002, status: 'returning series', seasons: [{ number: 1, title: 'Season 1', episodes: 8 }] },
  { trakt: 900003, slug: 'moonfall-academy', title: 'Moonfall Academy', year: 2025, tmdb: 990003, status: 'returning series', seasons: [{ number: 1, title: 'Season 1', episodes: 24 }] },
  { trakt: 900004, slug: 'iron-petals', title: 'Iron Petals', year: 2026, tmdb: 990004, status: 'ended', seasons: [{ number: 1, title: 'Season 1', episodes: 12 }] },
  { trakt: 900005, slug: 'lantern-road', title: 'Lantern Road', year: 2026, tmdb: 990005, status: 'returning series', seasons: [{ number: 1, title: 'Season 1', episodes: 12 }] },
  { trakt: 900006, slug: 'quiet-orbit', title: 'Quiet Orbit', year: 2026, tmdb: 990006, status: 'returning series', seasons: [{ number: 1, title: 'Season 1', episodes: 6 }] },
  { trakt: 900007, slug: 'clockwork-garden', title: 'Clockwork Garden', year: 2026, tmdb: 990007, status: 'returning series', seasons: [{ number: 1, title: 'Season 1', episodes: 13 }] },
  { trakt: 900008, slug: 'starling-tide', title: 'Starling Tide', year: 2026, tmdb: 990008, status: 'returning series', seasons: [{ number: 1, title: 'Season 1', episodes: 12 }] },
  { trakt: 900010, slug: 'ember-saga', title: 'Ember Saga', year: 2025, tmdb: 990010, status: 'ended', seasons: [{ number: 1, title: 'Season 1', episodes: 24 }] },
  { trakt: 900011, slug: 'ember-island', title: 'Ember Island', year: 2019, tmdb: 990011, status: 'ended', seasons: [{ number: 1, title: 'Season 1', episodes: 10 }] }
]

const catalog = (slug: string) => TRAKT_CATALOG.find(s => s.slug === slug)!

export function traktShowJson(s: TraktCatalogShow) {
  return {
    title: s.title,
    year: s.year,
    status: s.status,
    aired_episodes: s.seasons.reduce((n, x) => n + x.episodes, 0),
    ids: { trakt: s.trakt, slug: s.slug, tmdb: s.tmdb, tvdb: null, imdb: null }
  }
}

export interface AniListFixture {
  idMal: number
  id: number
  title: string
  english: string
  format: string
  episodes: number | null
  status: string
  year: number
  prequel?: number
}

export const ANILIST: AniListFixture[] = [
  { idMal: 950031, id: 960031, title: 'Getsuraku Gakuen', english: 'Moonfall Academy', format: 'TV', episodes: 12, status: 'FINISHED', year: 2025 },
  { idMal: 950032, id: 960032, title: 'Getsuraku Gakuen Part 2', english: 'Moonfall Academy Part 2', format: 'TV', episodes: 12, status: 'FINISHED', year: 2026, prequel: 950031 },
  { idMal: 950041, id: 960041, title: 'Tetsu no Hanabira', english: 'Iron Petals', format: 'TV', episodes: 12, status: 'FINISHED', year: 2026 },
  { idMal: 950051, id: 960051, title: 'Chouchin Kaidou', english: 'Lantern Road', format: 'TV', episodes: 12, status: 'FINISHED', year: 2026 },
  { idMal: 950071, id: 960071, title: 'Karakuri Teien', english: 'Clockwork Garden', format: 'TV', episodes: 13, status: 'FINISHED', year: 2026 },
  { idMal: 950081, id: 960081, title: 'Mukudori no Shio', english: 'Starling Tide', format: 'TV', episodes: null, status: 'RELEASING', year: 2026 },
  { idMal: 950091, id: 960091, title: 'Birodo Suisei', english: 'Velvet Comet', format: 'TV', episodes: 12, status: 'FINISHED', year: 2025 },
  { idMal: 950101, id: 960101, title: 'Hinoko Monogatari', english: 'Ember Saga', format: 'TV', episodes: 24, status: 'FINISHED', year: 2025 },
  { idMal: 950111, id: 960111, title: 'Haguruma no Guwa', english: 'Fable of Gears', format: 'OVA', episodes: 2, status: 'FINISHED', year: 2024 }
]

export function anilistMediaJson(a: AniListFixture) {
  const prequel = a.prequel ? ANILIST.find(x => x.idMal === a.prequel) : undefined
  return {
    id: a.id,
    idMal: a.idMal,
    format: a.format,
    episodes: a.episodes,
    status: a.status,
    season: null,
    seasonYear: a.year,
    synonyms: [],
    title: { romaji: a.title, english: a.english, native: null },
    startDate: { year: a.year, month: 1, day: 1 },
    relations: {
      edges: prequel
        ? [{ relationType: 'PREQUEL', node: { id: prequel.id, idMal: prequel.idMal, type: 'ANIME', format: prequel.format, episodes: prequel.episodes, status: prequel.status, title: { romaji: prequel.title, english: prequel.english }, startDate: { year: prequel.year } } }]
        : []
    }
  }
}

// The three watching lists as the sources answer them, dated relative to `now`.
export function demoLists(now: number) {
  const ago = (days: number) => new Date(now - days * DAY).toISOString()
  // Simkl dates anime episodes as midnight in Japan.
  const jstDate = (days: number) => `${new Date(now + days * DAY).toISOString().slice(0, 10)}T00:00:00+09:00`

  const traktItem = (slug: string, completed: number, next: { season: number, number: number, title: string, airedDaysAgo: number }, watchedDaysAgo: number) => {
    const s = catalog(slug)
    return {
      show: traktShowJson(s),
      progress: {
        aired: s.seasons.reduce((n, x) => n + x.episodes, 0),
        completed,
        last_watched_at: ago(watchedDaysAgo),
        next_episode: { season: next.season, number: next.number, title: next.title, first_aired: ago(next.airedDaysAgo) }
      }
    }
  }

  // Trakt orders up next by last watched, newest first.
  const trakt = [
    traktItem('moonfall-academy', 16, { season: 1, number: 17, title: 'The Second Bell', airedDaysAgo: 6 }, 0.1),
    traktItem('iron-petals', 7, { season: 1, number: 8, title: 'Thorns', airedDaysAgo: 40 }, 1),
    traktItem('harbor-lights', 14, { season: 2, number: 5, title: 'Low Tide', airedDaysAgo: 5 }, 2),
    traktItem('paper-kites', 2, { season: 1, number: 3, title: 'Crosswind', airedDaysAgo: 30 }, 3),
    traktItem('lantern-road', 3, { season: 1, number: 4, title: 'The Last Lamp', airedDaysAgo: 20 }, 4),
    traktItem('quiet-orbit', 4, { season: 1, number: 5, title: 'Signal Lost', airedDaysAgo: 3 }, 5),
    traktItem('clockwork-garden', 4, { season: 1, number: 5, title: 'Winding Down', airedDaysAgo: 10 }, 6)
  ]

  const simklShow = (simkl: number, title: string, ids: Record<string, unknown>, watched: number, total: number, next: string | null, nextTitle: string | null, watchedDaysAgo: number) => ({
    status: 'watching',
    added_to_watchlist_at: ago(60),
    last_watched_at: ago(watchedDaysAgo),
    last_watched: null,
    next_to_watch: next,
    watched_episodes_count: watched,
    total_episodes_count: total,
    not_aired_episodes_count: 0,
    user_rating: null,
    user_rated_at: null,
    ...(next && nextTitle ? { next_to_watch_info: { title: nextTitle, episode: Number(next.replace(/^S\d+E/, '')), date: ago(5) } } : {}),
    show: { title, year: 2025, poster: null, ids: { simkl, slug: title.toLowerCase().replace(/\W+/g, '-'), ...ids } }
  })

  const simklAnime = (simkl: number, title: string, mal: number, anilist: number, traktslug: string | null, watched: number, total: number, notAired: number, next: number | null, nextTitle: string | null, airsInDays: number, watchedDaysAgo: number | null, animeType = 'tv') => ({
    status: 'watching',
    added_to_watchlist_at: ago(60),
    last_watched_at: watchedDaysAgo === null ? null : ago(watchedDaysAgo),
    last_watched: null,
    next_to_watch: next === null ? null : `E${next}`,
    watched_episodes_count: watched,
    total_episodes_count: total,
    not_aired_episodes_count: notAired,
    user_rating: null,
    user_rated_at: null,
    anime_type: animeType,
    ...(next !== null ? { next_to_watch_info: { title: nextTitle, episode: next, date: jstDate(airsInDays) } } : {}),
    show: { title, year: 2026, poster: null, ids: { simkl, slug: title.toLowerCase().replace(/\W+/g, '-'), mal: String(mal), anilist: String(anilist), ...(traktslug ? { traktslug } : {}) } }
  })

  const simkl = {
    shows: [
      simklShow(970001, 'Harbor Lights', { traktslug: 'harbor-lights', tmdb: '990001' }, 14, 20, 'S02E05', 'Low Tide', 2),
      simklShow(970002, 'Paper Kites', { traktslug: 'paper-kites', tmdb: '990002' }, 3, 8, 'S01E04', 'Headwind', 1.5),
      simklShow(970020, 'Winter Ledger', {}, 2, 10, 'S01E03', 'Frost Accounts', 8)
    ],
    anime: [
      simklAnime(970032, 'Moonfall Academy Part 2', 950032, 960032, 'moonfall-academy', 4, 12, 0, 5, 'The Second Bell', -6, 0.1),
      simklAnime(970041, 'Iron Petals', 950041, 960041, 'iron-petals', 7, 12, 0, 8, 'Thorns', -40, 1),
      simklAnime(970051, 'Lantern Road', 950051, 960051, 'lantern-road', 4, 12, 0, 5, 'Paper Moons', -14, 1.2),
      simklAnime(970071, 'Clockwork Garden', 950071, 960071, 'clockwork-garden', 4, 13, 0, 5, 'Winding Down', -10, 6),
      simklAnime(970081, 'Starling Tide', 950081, 960081, 'starling-tide', 5, 12, 7, 6, 'Murmuration', 3, 7),
      simklAnime(970091, 'Velvet Comet', 950091, 960091, null, 12, 12, 0, null, null, 0, 30),
      simklAnime(970101, 'Ember Saga', 950101, 960101, null, 2, 24, 0, 3, 'Kindling', -200, 9)
    ]
  }

  const malItem = (id: number, title: string, watched: number, episodes: number, mediaType: string, status: string, updatedDaysAgo: number) => ({
    node: {
      id,
      title,
      main_picture: null,
      num_episodes: episodes,
      media_type: mediaType,
      status,
      alternative_titles: { synonyms: [], en: '', ja: '' },
      start_season: { year: 2026, season: 'winter' },
      start_date: '2026-01-05'
    },
    list_status: { status: 'watching', score: 0, num_episodes_watched: watched, is_rewatching: false, updated_at: ago(updatedDaysAgo) }
  })

  const mal = {
    data: [
      malItem(950032, 'Getsuraku Gakuen Part 2', 4, 12, 'tv', 'finished_airing', 0.1),
      malItem(950041, 'Tetsu no Hanabira', 6, 12, 'tv', 'finished_airing', 3),
      malItem(950051, 'Chouchin Kaidou', 3, 12, 'tv', 'finished_airing', 4),
      malItem(950071, 'Karakuri Teien', 4, 13, 'tv', 'finished_airing', 6),
      // MAL reports 0 episodes while a series airs.
      malItem(950081, 'Mukudori no Shio', 5, 0, 'tv', 'currently_airing', 7),
      malItem(950091, 'Birodo Suisei', 12, 12, 'tv', 'finished_airing', 30),
      malItem(950101, 'Hinoko Monogatari', 2, 24, 'tv', 'finished_airing', 9),
      malItem(950111, 'Haguruma no Guwa', 1, 2, 'ova', 'finished_airing', 12)
    ]
  }

  const activityBlock = { all: DEMO_ACTIVITIES_AT, watching: DEMO_ACTIVITIES_AT, plantowatch: DEMO_ACTIVITIES_AT, hold: DEMO_ACTIVITIES_AT, completed: DEMO_ACTIVITIES_AT, dropped: DEMO_ACTIVITIES_AT, removed_from_list: DEMO_ACTIVITIES_AT, rated_at: DEMO_ACTIVITIES_AT }
  const activities = { all: DEMO_ACTIVITIES_AT, tv_shows: { ...activityBlock }, anime: { ...activityBlock } }

  return { trakt, simkl, mal, activities }
}

export type DemoLists = ReturnType<typeof demoLists>
