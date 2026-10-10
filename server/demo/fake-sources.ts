import { ANILIST, anilistMediaJson, anilistScheduleJson, demoLists, TRAKT_CATALOG, traktCalendarJson, traktShowJson, type DemoLists } from './fixtures'

// A stand-in for Trakt, Simkl, MAL and AniList in demo mode: a `fetch` that answers the requests the
// adapters make from the fixtures, and applies "mark watched" writes to its own copy of the lists so the
// next read shows them. The real adapters, source wrapper and parsing all run; only the network is fake.
// The state lives in memory and starts over when the server restarts.

type Json = Record<string, unknown>
type Host = 'trakt' | 'simkl' | 'mal' | 'anilist'

const HOSTS: Record<string, Host> = {
  'api.trakt.tv': 'trakt',
  'api.simkl.com': 'simkl',
  'api.myanimelist.net': 'mal',
  'graphql.anilist.co': 'anilist'
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const notFound = () => json({ error: 'not found' }, 404)

export interface DemoSourceOptions {
  now?: () => number
  // Sources that answer every request with a rate limit, to see "blocked" and stale data (DEMO_FAIL=mal,simkl).
  fail?: Host[]
}

export function createDemoSources(opts: DemoSourceOptions = {}) {
  const now = opts.now ?? Date.now
  const state: DemoLists = demoLists(now())
  // When each Simkl item last changed, for `date_from` deltas.
  const simklChanged = new Map<number, string>()
  // Trakt show ID -> your rating.
  const traktRatings = new Map<number, number>()

  const isoNow = () => new Date(now()).toISOString()
  // MAL list entries that are not on Watching (season 1 of Glass Harbor, completed; Tidewater Saints).
  const malOffList = new Map<number, Json>([
    [950141, { status: 'completed', score: 8, num_episodes_watched: 12, is_rewatching: false, start_date: '2025-07-02', finish_date: '2025-09-20', updated_at: new Date(now() - 30 * 24 * 60 * 60 * 1000).toISOString() }],
    // Tidewater Saints: season 1 completed, season 2 queued.
    [950161, { status: 'completed', score: 7, num_episodes_watched: 12, is_rewatching: false, start_date: '2025-04-03', finish_date: '2025-06-20', updated_at: new Date(now() - 90 * 24 * 60 * 60 * 1000).toISOString() }],
    [950162, { status: 'plan_to_watch', score: 0, num_episodes_watched: 0, is_rewatching: false, updated_at: new Date(now() - 20 * 24 * 60 * 60 * 1000).toISOString() }]
  ])
  const simklId = (item: Json) => (item.show as { ids: { simkl: number } }).ids.simkl

  function trakt(url: URL, init: RequestInit | undefined): Response {
    const path = url.pathname
    if (path === '/users/settings') return json({ user: { username: 'demo', private: false, ids: { slug: 'demo', uuid: 'demo' } }, account: { timezone: 'UTC' } })
    // Trakt's stats endpoint answers an empty 204 (#89); the card counts the lists instead.
    if (path === '/users/me/stats' || path === '/users/demo/stats') return new Response(null, { status: 204 })
    if (path === '/users/demo/watched/shows') {
      // 37 shows, paged like Trakt (limit capped, here at 25): page count and limit in the headers.
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 25)
      const page = Number(url.searchParams.get('page') ?? 1)
      const all = Array.from({ length: 37 }, (_, i) => ({ plays: 50 + i, show: { ids: { trakt: 9000 + i } } }))
      return new Response(JSON.stringify(all.slice((page - 1) * limit, page * limit)), {
        headers: { 'content-type': 'application/json', 'x-pagination-page': String(page), 'x-pagination-limit': String(limit), 'x-pagination-page-count': String(Math.ceil(all.length / limit)), 'x-pagination-item-count': String(all.length) }
      })
    }
    if (path === '/users/demo/ratings') {
      const shows = [4, 5, 5, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 8, 9, 9, 9, 10, 10].map(rating => ({ rating, type: 'show' }))
      return json([...shows, { rating: 8, type: 'episode' }, { rating: 7, type: 'season' }, { rating: 9, type: 'movie' }])
    }
    if (path === '/sync/ratings/shows') return json([...traktRatings].map(([id, rating]) => ({ rated_at: isoNow(), rating, type: 'show', show: { ids: { trakt: id } } })))
    if (path === '/sync/ratings' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { shows?: { ids: { trakt: number }, rating: number }[] }
      const want = body.shows?.[0]
      if (!want || !TRAKT_CATALOG.some(s => s.trakt === want.ids.trakt)) return json({ added: { shows: 0 }, not_found: { shows: want ? [want] : [] } }, 201)
      traktRatings.set(want.ids.trakt, want.rating)
      return json({ added: { movies: 0, shows: 1, seasons: 0, episodes: 0 }, not_found: { movies: [], shows: [], seasons: [], episodes: [] } }, 201)
    }
    const cal = /^\/calendars\/my\/shows\/(\d{4}-\d{2}-\d{2})\/(\d+)$/.exec(path)
    if (cal) return json(traktCalendarJson(now(), cal[1]!, Math.min(Number(cal[2]), 33)))
    if (path === '/sync/progress/up_next') return json(url.searchParams.get('page') === '1' || !url.searchParams.get('page') ? state.trakt : [])

    if (path === '/sync/history' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { shows?: { ids: { trakt: number }, seasons: { number: number, episodes: { number: number }[] }[] }[] }
      const want = body.shows?.[0]
      const item = state.trakt.find(i => i.show.ids.trakt === want?.ids.trakt)
      const season = want?.seasons[0]
      const ep = season?.episodes[0]
      const next = item?.progress.next_episode
      if (!item || !next || !season || !ep) return json({ added: { movies: 0, episodes: 0 }, not_found: { shows: [want ?? null] } }, 201)
      // Like Trakt, any aired episode can be added; up next only moves when it was the next one.
      if (next.season === season.number && next.number === ep.number) {
        item.progress.completed += 1
        item.progress.last_watched_at = isoNow()
        const catalogShow = TRAKT_CATALOG.find(s => s.trakt === item.show.ids.trakt)!
        const seasonSize = catalogShow.seasons.find(s => s.number === next.season)?.episodes ?? 0
        if (item.progress.completed >= item.progress.aired) {
          state.trakt.splice(state.trakt.indexOf(item), 1)
        } else {
          const rollOver = next.number >= seasonSize
          item.progress.next_episode = {
            season: rollOver ? next.season + 1 : next.season,
            number: rollOver ? 1 : next.number + 1,
            title: `Episode ${rollOver ? 1 : next.number + 1}`,
            first_aired: new Date(Date.parse(next.first_aired) + 7 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
        // Up next is ordered by last watched.
        state.trakt.sort((a, b) => b.progress.last_watched_at.localeCompare(a.progress.last_watched_at))
      }
      return json({ added: { movies: 0, episodes: 1 }, updated: { movies: 0, episodes: 0 }, not_found: { movies: [], shows: [], seasons: [], episodes: [], people: [], users: [] } }, 201)
    }

    // No demo show has a next episode scheduled on Trakt: 204, as Trakt answers then.
    if (/^\/shows\/[^/]+\/next_episode$/.test(path)) return new Response(null, { status: 204 })

    // Public lookups: /shows/<slug or id>, /shows/<id>/seasons, /search/tmdb/<id>, /search/show?query=
    const seasons = /^\/shows\/(\d+)\/seasons$/.exec(path)
    if (seasons) {
      const show = TRAKT_CATALOG.find(s => s.trakt === Number(seasons[1]))
      return show ? json(show.seasons.map(s => ({ number: s.number, title: s.title, episode_count: s.episodes, aired_episodes: s.episodes, ids: { trakt: show.trakt * 10 + s.number } }))) : notFound()
    }
    const show = /^\/shows\/([^/]+)$/.exec(path)
    if (show) {
      const key = decodeURIComponent(show[1]!)
      const found = TRAKT_CATALOG.find(s => s.slug === key || String(s.trakt) === key)
      return found ? json(traktShowJson(found)) : notFound()
    }
    const tmdb = /^\/search\/tmdb\/(\d+)$/.exec(path)
    if (tmdb) {
      const found = TRAKT_CATALOG.find(s => s.tmdb === Number(tmdb[1]))
      return json(found ? [{ score: 1000, type: 'show', show: traktShowJson(found) }] : [])
    }
    if (path === '/search/show') {
      const words = (url.searchParams.get('query') ?? '').toLowerCase().split(/\W+/).filter(Boolean)
      const found = TRAKT_CATALOG.filter(s => words.some(w => s.title.toLowerCase().includes(w)))
      return json(found.map(s => ({ score: 1000, type: 'show', show: traktShowJson(s) })))
    }
    return notFound()
  }

  function simkl(url: URL, init: RequestInit | undefined): Response {
    const path = url.pathname
    if (path === '/sync/activities') return json(state.activities)
    if (path === '/users/settings') return json({ user: { name: 'Demo' }, account: { id: 4242, timezone: 'UTC', type: 'free' } })
    if (path === '/users/4242/stats') {
      const watching = (type: 'shows' | 'anime') => ({
        count: state.simkl[type].length,
        watched_episodes_count: (state.simkl[type] as { watched_episodes_count: number }[]).reduce((n, i) => n + i.watched_episodes_count, 0),
        left_to_watch_episodes: (state.simkl[type] as { watched_episodes_count: number, total_episodes_count: number }[]).reduce((n, i) => n + i.total_episodes_count - i.watched_episodes_count, 0)
      })
      return json({
        total_mins: 71240,
        movies: { total_mins: 5400, plantowatch: { mins: 0, count: 6 }, completed: { mins: 5400, count: 44 }, dropped: { mins: 0, count: 1 } },
        tv: { total_mins: 41800, watching: watching('shows'), completed: { count: 22 }, hold: { count: 3 }, dropped: { count: 2 }, plantowatch: { count: 14 } },
        anime: { total_mins: 24040, watching: watching('anime'), completed: { count: 31 }, hold: { count: 1 }, dropped: { count: 4 }, plantowatch: { count: 9 } },
        watched_last_week: { total_mins: 410, movies_mins: 0, tv_mins: 180, anime_mins: 230 }
      })
    }

    const list = /^\/sync\/all-items\/(shows|anime)(\/watching)?$/.exec(path)
    if (list) {
      const type = list[1] as 'shows' | 'anime'
      let items = state.simkl[type] as Json[]
      const from = url.searchParams.get('date_from')
      if (!list[2] && from) items = items.filter(i => (simklChanged.get(simklId(i)) ?? '') > from)
      if (url.searchParams.get('extended') === 'simkl_ids_only') items = items.map(i => ({ show: { ids: { simkl: simklId(i) } } }))
      return json(items.length ? { [type]: items } : {})
    }

    if (path === '/sync/ratings' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { shows?: { ids: { simkl: number }, rating: number }[], anime?: { ids: { simkl: number }, rating: number }[] }
      const type = body.anime ? 'anime' : 'shows'
      const want = (body.anime ?? body.shows)?.[0]
      const item = (state.simkl[type] as Json[]).find(i => simklId(i) === want?.ids.simkl)
      if (!want || !item || want.rating < 1 || want.rating > 10) return json({ added: { movies: 0, shows: 0 }, not_found: { movies: [], shows: want ? [want] : [] } }, 201)
      item.user_rating = want.rating
      // The demo moves the watching bucket so the next read refetches the item (the adapter follows list buckets only).
      const at = isoNow()
      const block = body.anime ? state.activities.anime : state.activities.tv_shows
      simklChanged.set(simklId(item), at)
      block.all = at
      block.watching = at
      state.activities.all = at
      return json({ added: { movies: 0, shows: 1 }, not_found: { movies: [], shows: [] } }, 201)
    }

    if (path === '/sync/add-to-list' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { shows?: { to: string, ids: { mal?: number } }[] }
      const sent = body.shows?.[0]
      const a = ANILIST.find(x => x.idMal === sent?.ids.mal)
      if (!sent || !a) return json({ added: { movies: [], shows: [] }, not_found: { movies: [], shows: sent ? [sent] : [] } }, 201)
      const id = 970000 + (a.idMal - 950000)
      const anime = state.simkl.anime as Json[]
      if (sent.to === 'watching' && !anime.some(i => simklId(i) === id)) {
        const aired = a.nextAiring ? a.nextAiring.episode - 1 : a.episodes ?? 0
        anime.unshift({
          status: 'watching', added_to_watchlist_at: isoNow(), last_watched_at: null, last_watched: null,
          next_to_watch: 'E1', watched_episodes_count: 0, total_episodes_count: a.episodes ?? aired, not_aired_episodes_count: (a.episodes ?? aired) - aired,
          user_rating: null, user_rated_at: null, anime_type: 'tv', next_to_watch_info: { title: null, episode: 1, date: null },
          show: { title: a.english, year: a.year, poster: null, ids: { simkl: id, slug: a.english.toLowerCase().replace(/\W+/g, '-'), mal: String(a.idMal), anilist: String(a.id) } }
        })
        const at = isoNow()
        simklChanged.set(id, at)
        state.activities.anime.all = at
        state.activities.anime.watching = at
        state.activities.all = at
      }
      return json({ added: { movies: [], shows: [sent] }, not_found: { movies: [], shows: [] } }, 201)
    }

    if (path === '/sync/history' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { shows?: { ids: { simkl: number }, status?: string }[], anime?: { ids: { simkl: number }, status?: string }[] }
      const type = body.anime ? 'anime' : 'shows'
      const sent = (body.anime ?? body.shows)?.[0]
      const id = sent?.ids.simkl
      const item = (state.simkl[type] as Json[]).find(i => simklId(i) === id) as (Json & { watched_episodes_count: number, total_episodes_count: number, not_aired_episodes_count: number, next_to_watch: string | null }) | undefined
      if (!item) return json({ added: { movies: 0, shows: 0, episodes: 0 }, not_found: { [type]: [{ ids: { simkl: id } }] } }, 201)
      item.watched_episodes_count += 1
      item.last_watched_at = isoNow()
      const aired = item.total_episodes_count - item.not_aired_episodes_count
      const current = /^(S\d+)?E(\d+)$/.exec(item.next_to_watch ?? '')
      item.next_to_watch = item.watched_episodes_count >= aired || !current ? null : `${current[1] ?? ''}E${String(Number(current[2]) + 1).padStart(current[1] ? 2 : 1, '0')}`
      if (item.next_to_watch === null) delete item.next_to_watch_info
      else item.next_to_watch_info = { title: null, episode: Number(current![2]) + 1, date: null }
      const at = isoNow()
      simklChanged.set(id!, at)
      const block = type === 'anime' ? state.activities.anime : state.activities.tv_shows
      // Like Simkl: the status sent, else Completed once every episode is watched (aired ones while airing
      // stay in Watching, which the demo does not tell apart). Anything but Watching leaves the list.
      const status = sent?.status ?? (item.watched_episodes_count >= item.total_episodes_count ? 'completed' : 'watching')
      if (status !== 'watching') (state.simkl[type] as Json[]).splice((state.simkl[type] as Json[]).indexOf(item), 1)
      block.all = at
      block.watching = at
      state.activities.all = at
      return json({ added: { movies: 0, shows: 0, episodes: 1, statuses: [{ request: sent, response: { status, simkl_type: type === 'anime' ? 'anime' : 'tv' } }] }, not_found: { movies: [], shows: [], anime: [] } }, 201)
    }
    return notFound()
  }

  function mal(url: URL, init: RequestInit | undefined): Response {
    if (url.pathname === '/v2/users/@me') {
      return json({
        id: 1, name: 'Demo', joined_at: '2020-01-01T00:00:00+00:00',
        anime_statistics: {
          num_items_watching: state.mal.data.length, num_items_completed: 30, num_items_on_hold: 1, num_items_dropped: 4, num_items_plan_to_watch: 9,
          num_items: state.mal.data.length + 44, num_days_watched: 16.7, num_days_watching: 1.2, num_days_completed: 14.9, num_days_on_hold: 0.2,
          num_days_dropped: 0.4, num_days: 16.7, num_episodes: 1203, num_times_rewatched: 2, mean_score: 7.62
        }
      })
    }
    if (url.pathname === '/v2/users/@me/animelist') {
      // The Watching list, or with no status filter every entry, off-list ones (completed) included.
      const want = url.searchParams.get('status')
      if (want && want !== 'watching') return json({ data: [], paging: {} })
      const off = want ? [] : [...malOffList].map(([id, list_status]) => ({ node: { id, title: ANILIST.find(x => x.idMal === id)?.title ?? '' }, list_status }))
      return json({ data: [...state.mal.data, ...off], paging: {} })
    }
    // An anime's page with your list status, left out when it is not on your list.
    const detail = /^\/v2\/anime\/(\d+)$/.exec(url.pathname)
    if (detail && (!init?.method || init.method === 'GET')) {
      const id = Number(detail[1])
      const a = ANILIST.find(x => x.idMal === id)
      if (!a) return notFound()
      const listed = state.mal.data.find(i => i.node.id === id)?.list_status ?? malOffList.get(id)
      return json({ id, title: a.title, main_picture: null, ...(listed ? { my_list_status: listed } : {}) })
    }
    const status = /^\/v2\/anime\/(\d+)\/my_list_status$/.exec(url.pathname)
    if (status && init?.method === 'PATCH') {
      const form = new URLSearchParams(String(init.body))
      const id = Number(status[1])
      let item = state.mal.data.find(i => i.node.id === id)
      // Putting an anime that is not on the list on Watching adds it, like MAL.
      const fixture = ANILIST.find(x => x.idMal === id)
      if (!item && form.get('status') === 'watching' && fixture) {
        item = {
          node: { id, title: fixture.title, main_picture: null, num_episodes: fixture.episodes ?? 0, media_type: 'tv', status: fixture.status === 'RELEASING' ? 'currently_airing' : 'finished_airing', alternative_titles: { synonyms: [], en: fixture.english, ja: '' }, start_season: { year: fixture.year, season: 'fall' }, start_date: `${fixture.year}-10-01` },
          list_status: { status: 'watching', score: 0, num_episodes_watched: 0, is_rewatching: false, updated_at: isoNow(), ...(form.get('start_date') ? { start_date: form.get('start_date')! } : {}) }
        }
        state.mal.data.unshift(item)
        malOffList.delete(id)
        return json(item.list_status)
      }
      if (!item) return notFound()
      if (form.has('num_watched_episodes')) item.list_status.num_episodes_watched = Number(form.get('num_watched_episodes'))
      if (form.has('score')) item.list_status.score = Number(form.get('score'))
      if (form.get('start_date')) (item.list_status as Json).start_date = form.get('start_date')
      item.list_status.updated_at = isoNow()
      if (form.get('finish_date')) (item.list_status as Json).finish_date = form.get('finish_date')
      const listStatus = form.get('status')
      if (listStatus && listStatus !== 'watching') {
        item.list_status.status = listStatus
        state.mal.data.splice(state.mal.data.indexOf(item), 1)
        malOffList.set(id, item.list_status)
      }
      return json(item.list_status)
    }
    return notFound()
  }

  function anilist(init: RequestInit | undefined): Response {
    const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string, variables?: { ids?: number[], search?: string, from?: number, to?: number } }
    if (body.query?.includes('airingSchedules')) {
      const v = body.variables ?? {}
      return json({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: anilistScheduleJson(now(), v.ids ?? [], v.from ?? 0, v.to ?? 0) } } })
    }
    const search = body.variables?.search?.toLowerCase().split(/\s+/).filter(Boolean)
    if (search) {
      const found = ANILIST.filter(a => search.every(w => `${a.title} ${a.english}`.toLowerCase().includes(w)))
      return json({ data: { Page: { media: found.map(a => anilistMediaJson(a, now())) } } })
    }
    const ids = new Set(body.variables?.ids ?? [])
    return json({ data: { Page: { pageInfo: { hasNextPage: false }, media: ANILIST.filter(a => ids.has(a.idMal)).map(a => anilistMediaJson(a, now())) } } })
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const host = HOSTS[url.hostname]
    // Anything else would leave the machine; demo mode never lets that happen.
    if (!host) throw new Error(`Demo mode does not call ${url.hostname}`)
    if (opts.fail?.includes(host)) return new Response('', { status: 429, headers: { 'retry-after': '300' } })
    if (host === 'trakt') return trakt(url, init)
    if (host === 'simkl') return simkl(url, init)
    if (host === 'mal') return mal(url, init)
    return anilist(init)
  }

  return { fetch, state }
}
