import { ANILIST, anilistMediaJson, demoLists, TRAKT_CATALOG, traktShowJson, type DemoLists } from './fixtures'

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

  const isoNow = () => new Date(now()).toISOString()
  const simklId = (item: Json) => (item.show as { ids: { simkl: number } }).ids.simkl

  function trakt(url: URL, init: RequestInit | undefined): Response {
    const path = url.pathname
    if (path === '/users/me/stats') {
      return json({
        movies: { plays: 48, watched: 45, minutes: 5520, collected: 0, ratings: 12, comments: 0 },
        shows: { watched: 37, collected: 0, ratings: 20, comments: 0 },
        seasons: { ratings: 2, comments: 0 },
        episodes: { plays: 1910, watched: 1874, minutes: 52480, collected: 0, ratings: 3, comments: 0 },
        network: { friends: 0, followers: 0, following: 0 },
        ratings: { total: 37, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2, 6: 4, 7: 9, 8: 11, 9: 6, 10: 4 } }
      })
    }
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
    if (url.pathname === '/v2/users/@me/animelist') return json({ data: state.mal.data, paging: {} })
    const status = /^\/v2\/anime\/(\d+)\/my_list_status$/.exec(url.pathname)
    if (status && init?.method === 'PATCH') {
      const form = new URLSearchParams(String(init.body))
      const item = state.mal.data.find(i => i.node.id === Number(status[1]))
      if (!item) return notFound()
      item.list_status.num_episodes_watched = Number(form.get('num_watched_episodes'))
      item.list_status.updated_at = isoNow()
      const listStatus = form.get('status')
      if (listStatus && listStatus !== 'watching') {
        item.list_status.status = listStatus
        state.mal.data.splice(state.mal.data.indexOf(item), 1)
      }
      return json(item.list_status)
    }
    return notFound()
  }

  function anilist(init: RequestInit | undefined): Response {
    const body = JSON.parse(String(init?.body ?? '{}')) as { variables?: { ids?: number[] } }
    const ids = new Set(body.variables?.ids ?? [])
    return json({ data: { Page: { pageInfo: { hasNextPage: false }, media: ANILIST.filter(a => ids.has(a.idMal)).map(anilistMediaJson) } } })
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
