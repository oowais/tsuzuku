import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { metadataCache } from '../db/schema'
import { httpsUrl } from '../lib/entries'
import { clientCredentials } from '../lib/env'
import { USER_AGENT } from '../lib/oauth/providers'
import type { createSourceWrapper, SourceResult } from '../lib/source-wrapper'
import { USER_ID } from '../lib/user'

// Trakt public endpoints: no user token, only the client ID. Shapes checked against real responses on
// 2026-10-08 (trakt.tv's API reference blocks scripted reads):
// - GET /search/show?query=   -> [{ score, type, show }]   (score is an undocumented huge number; not used)
// - GET /search/tmdb/<id>?type=show -> [{ score, type, show }], [] when unknown
// - GET /shows/<slug or id>   -> show, 404 when unknown
// - GET /shows/<id>/seasons?extended=full -> [{ number, title, episode_count, aired_episodes, ids }]
// - GET /shows/<id>/next_episode?extended=full -> the next episode to air ({ season, number, title, first_aired,
//   ... }), or 204 with an empty body when none is scheduled (seen 2026-10-09)
// A show has `ids { trakt, slug, tmdb, tvdb, imdb }`, `title`, `year`, and with extended data more.
const API = 'https://api.trakt.tv'

// Lookups by ID and season lists change rarely; searches are not cached.
export const TRAKT_LOOKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface TraktShow {
  trakt: number
  slug: string
  title: string
  originalTitle: string | null
  year: number | null
  tmdb: number | null
  airedEpisodes: number | null
}

// The next episode Trakt has scheduled for a show.
export interface TraktNextEpisode {
  season: number
  number: number
  title: string | null
  firstAired: string
}

// Air dates move, so the next episode is asked again after a day, or as soon as the cached one has aired.
export const TRAKT_NEXT_EPISODE_TTL_MS = 24 * 60 * 60 * 1000

export function toNextEpisode(raw: unknown): TraktNextEpisode | null {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Json
  if (typeof e.season !== 'number' || typeof e.number !== 'number' || typeof e.first_aired !== 'string') return null
  return { season: e.season, number: e.number, title: typeof e.title === 'string' ? e.title : null, firstAired: e.first_aired }
}

export interface TraktSeason {
  number: number
  title: string | null
  episodeCount: number | null
  airedEpisodes: number | null
  poster: string | null
}

type Json = Record<string, unknown>

export function toTraktShow(raw: unknown): TraktShow | null {
  const show = (raw && typeof raw === 'object' ? raw : {}) as Json
  const ids = (show.ids && typeof show.ids === 'object' ? show.ids : {}) as Json
  if (typeof ids.trakt !== 'number' || typeof ids.slug !== 'string') return null
  return {
    trakt: ids.trakt,
    slug: ids.slug,
    title: typeof show.title === 'string' ? show.title : ids.slug,
    originalTitle: typeof show.original_title === 'string' && show.original_title !== show.title ? show.original_title : null,
    year: typeof show.year === 'number' ? show.year : null,
    tmdb: typeof ids.tmdb === 'number' ? ids.tmdb : null,
    airedEpisodes: typeof show.aired_episodes === 'number' ? show.aired_episodes : null
  }
}

function toSeason(raw: unknown): TraktSeason | null {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Json
  if (typeof s.number !== 'number') return null
  return {
    number: s.number,
    title: typeof s.title === 'string' ? s.title : null,
    episodeCount: typeof s.episode_count === 'number' ? s.episode_count : null,
    airedEpisodes: typeof s.aired_episodes === 'number' ? s.aired_episodes : null,
    poster: httpsUrl(Array.isArray((s.images as Json | undefined)?.poster) ? ((s.images as Json).poster as unknown[])[0] : null)
  }
}

// A trakt.tv show link, as pasted: https://trakt.tv/shows/<slug>[/...]. Returns the slug.
export function slugFromTraktUrl(text: string): string | null {
  const match = /^\s*(?:https?:\/\/)?(?:www\.|app\.)?trakt\.tv\/shows\/([a-z0-9-]+)/i.exec(text)
  return match ? match[1]!.toLowerCase() : null
}

export interface TraktPublicOptions {
  db: Db
  wrapper: ReturnType<typeof createSourceWrapper>
  env?: NodeJS.ProcessEnv
  fetch?: typeof globalThis.fetch
  now?: () => number
  userId?: number
}

export type Lookup<T> = { status: SourceResult<unknown>['status'], data: T, retryAfter?: number | null, error?: string }

export function createTraktPublic(opts: TraktPublicOptions) {
  const { db, wrapper } = opts
  const doFetch = opts.fetch ?? globalThis.fetch
  const now = opts.now ?? Date.now
  const userId = opts.userId ?? USER_ID

  async function get<T>(path: string, params: Record<string, string> = {}, parse?: (r: Response) => Promise<T>): Promise<SourceResult<T>> {
    const { clientId } = clientCredentials('trakt', opts.env)
    const url = new URL(path, API)
    url.search = new URLSearchParams(params).toString()
    return wrapper.call<T>({
      source: 'trakt',
      notFoundOk: true,
      parse,
      fetcher: () => doFetch(url, {
        headers: { 'trakt-api-key': clientId, 'trakt-api-version': '2', 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' }
      })
    })
  }

  // Cached lookup: a fresh cache entry (including "not found") is used without calling Trakt.
  // `fresh` decides whether a cached entry can be used, by default for TRAKT_LOOKUP_TTL_MS.
  async function cached<T>(key: string, load: () => Promise<SourceResult<unknown>>, read: (raw: unknown) => T, fresh = (_raw: unknown, age: number) => age < TRAKT_LOOKUP_TTL_MS): Promise<Lookup<T>> {
    const where = and(eq(metadataCache.userId, userId), eq(metadataCache.provider, 'trakt'), eq(metadataCache.externalId, key))
    const row = db.select().from(metadataCache).where(where).get()
    if (row && fresh((row.json as { raw: unknown }).raw, now() - row.fetchedAt.getTime())) return { status: 'ok', data: read((row.json as { raw: unknown }).raw) }

    const res = await load()
    if (res.status !== 'ok') {
      // Blocked or failing: an expired cache entry is still better than nothing.
      return { status: res.status, data: read(row ? (row.json as { raw: unknown }).raw : null), retryAfter: res.retryAfter, error: res.error }
    }
    const json = { raw: res.data }
    const fetchedAt = new Date(now())
    db.insert(metadataCache).values({ userId, provider: 'trakt', externalId: key, json, fetchedAt })
      .onConflictDoUpdate({ target: [metadataCache.userId, metadataCache.provider, metadataCache.externalId], set: { json, fetchedAt } })
      .run()
    return { status: 'ok', data: read(res.data) }
  }

  const firstShow = (raw: unknown) => (Array.isArray(raw) ? toTraktShow((raw[0] as Json | undefined)?.show) : null)

  return {
    showBySlug: (slug: string) => cached(`show:slug:${slug}`, () => get(`/shows/${encodeURIComponent(slug)}`), toTraktShow),
    showById: (trakt: number) => cached(`show:id:${trakt}`, () => get(`/shows/${trakt}`), toTraktShow),
    showByTmdb: (tmdb: number) => cached(`show:tmdb:${tmdb}`, () => get(`/search/tmdb/${tmdb}`, { type: 'show' }), firstShow),
    // The next episode to air, for caught-up shows (#62). Null when Trakt has none scheduled (204).
    nextEpisode: (show: string | number) => cached(`next:${show}`,
      () => get(`/shows/${encodeURIComponent(String(show))}/next_episode`, { extended: 'full' }, async r => (r.status === 204 ? null : await r.json())),
      toNextEpisode,
      (raw, age) => {
        const next = toNextEpisode(raw)
        return age < TRAKT_NEXT_EPISODE_TTL_MS && (!next || Date.parse(next.firstAired) > now())
      }),
    seasons: (trakt: number) => cached(`seasons:${trakt}`, () => get(`/shows/${trakt}/seasons`, { extended: 'full' }),
      raw => (Array.isArray(raw) ? raw.map(toSeason).filter((s): s is TraktSeason => s !== null) : [])),

    // Text search, or a pasted trakt.tv link. Not cached: you are typing.
    async search(query: string): Promise<Lookup<TraktShow[]>> {
      const slug = slugFromTraktUrl(query)
      if (slug) {
        const res = await this.showBySlug(slug)
        return { ...res, data: res.data ? [res.data] : [] }
      }
      const res = await get<unknown[]>('/search/show', { query, limit: '10', extended: 'full' })
      const shows = (res.data ?? []).map(r => toTraktShow((r as Json).show)).filter((s): s is TraktShow => s !== null)
      return { status: res.status, data: shows, retryAfter: res.retryAfter, error: res.error }
    }
  }
}
