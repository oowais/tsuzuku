import { and, eq, gt } from 'drizzle-orm'
import type { Db } from '../db'
import { writeLog } from '../db/schema'
import type { SourceResult } from './source-wrapper'
import { USER_ID } from './user'

// The stats page (#53): each source's own numbers, side by side and never added up (the sources count
// differently; decision: show, don't resolve). The field names come from each source's reference and are
// read leniently: a missing field leaves its figure out instead of showing 0. The raw answer is kept, so
// the first real answers can be checked against these readers.

export type StatsSource = 'trakt' | 'simkl' | 'mal'

// One figure: a count, minutes (shown as hours or days), or a score.
export interface Figure {
  label: string
  value: number
  unit?: 'minutes' | 'days' | 'score'
}

export interface SourceStats {
  source: StatsSource
  status: SourceResult<unknown>['status']
  stale: boolean
  fetchedAt: Date | null
  error: string | null
  groups: { title: string, figures: Figure[] }[]
  raw: unknown
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// The figures whose value the source gave, in this order.
function figures(list: [string, unknown, Figure['unit']?][]): Figure[] {
  return list.flatMap(([label, v, unit]) => {
    const value = num(v)
    return value === null ? [] : [{ label, value, ...(unit ? { unit } : {}) }]
  })
}

// Trakt /users/me/stats: { movies, shows, episodes: { plays, watched, minutes, ... }, ratings: { total } }.
export function traktGroups(raw: unknown) {
  const r = obj(raw)
  const episodes = obj(r.episodes)
  const shows = obj(r.shows)
  const movies = obj(r.movies)
  return [
    { title: 'Shows', figures: figures([['Shows watched', shows.watched], ['Episodes watched', episodes.watched], ['Episode plays', episodes.plays], ['Time watching episodes', episodes.minutes, 'minutes']]) },
    { title: 'Movies', figures: figures([['Movies watched', movies.watched], ['Time watching movies', movies.minutes, 'minutes']]) },
    { title: 'Ratings', figures: figures([['Ratings given', obj(r.ratings).total]]) }
  ].filter(g => g.figures.length)
}

// Simkl /users/{id}/stats: { total_mins, tv: { total_mins, watching: { count, ... }, completed: { count }, ... },
// anime: { ... }, movies: { ... }, watched_last_week: { total_mins } }.
const SIMKL_LISTS: [string, string][] = [['watching', 'Watching'], ['completed', 'Completed'], ['hold', 'On hold'], ['dropped', 'Dropped'], ['plantowatch', 'Plan to watch']]
export function simklGroups(raw: unknown) {
  const r = obj(raw)
  const lists = (block: Json) => SIMKL_LISTS.map(([key, label]): [string, unknown] => [label, obj(block[key]).count])
  const tv = obj(r.tv)
  const anime = obj(r.anime)
  const left = (block: Json) => obj(block.watching).left_to_watch_episodes
  return [
    { title: 'Overall', figures: figures([['Time watched', r.total_mins, 'minutes'], ['Last week', obj(r.watched_last_week).total_mins, 'minutes']]) },
    { title: 'TV', figures: figures([['Time watched', tv.total_mins, 'minutes'], ...lists(tv), ['Episodes left in Watching', left(tv)]]) },
    { title: 'Anime', figures: figures([['Time watched', anime.total_mins, 'minutes'], ...lists(anime), ['Episodes left in Watching', left(anime)]]) },
    { title: 'Movies', figures: figures([['Time watched', obj(r.movies).total_mins, 'minutes'], ['Completed', obj(obj(r.movies).completed).count]]) }
  ].filter(g => g.figures.length)
}

// MAL /users/@me?fields=anime_statistics: { anime_statistics: { num_items_watching, ..., num_days_watched,
// num_episodes, mean_score } }.
export function malGroups(raw: unknown) {
  const s = obj(obj(raw).anime_statistics)
  return [
    { title: 'Anime', figures: figures([
      ['Days watched', s.num_days_watched, 'days'], ['Episodes', s.num_episodes], ['Mean score', s.mean_score, 'score'],
      ['Watching', s.num_items_watching], ['Completed', s.num_items_completed], ['On hold', s.num_items_on_hold],
      ['Dropped', s.num_items_dropped], ['Plan to watch', s.num_items_plan_to_watch], ['Rewatched', s.num_times_rewatched]
    ]) }
  ].filter(g => g.figures.length)
}

const READERS: Record<StatsSource, (raw: unknown) => SourceStats['groups']> = { trakt: traktGroups, simkl: simklGroups, mal: malGroups }

// Only the statistics part of MAL's answer, which also carries the account's name and picture.
const rawPart = (source: StatsSource, data: unknown) => source === 'mal' ? obj(data).anime_statistics ?? null : data

export function summarize(source: StatsSource, res: SourceResult<unknown>): SourceStats {
  return {
    source,
    status: res.status,
    stale: res.stale,
    fetchedAt: res.fetchedAt,
    error: res.status === 'ok' ? null : res.error ?? res.status,
    groups: res.data ? READERS[source](res.data) : [],
    raw: res.data ? rawPart(source, res.data) : null
  }
}

// Tsuzuku's own numbers, from the write log: marks the sources took, per source, over a few windows.
export function writeStats(db: Db, now = Date.now(), userId = USER_ID) {
  const DAY = 24 * 60 * 60 * 1000
  const since = (days: number) => new Date(now - days * DAY)
  const rows = db.select({ source: writeLog.source, at: writeLog.at, result: writeLog.result })
    .from(writeLog)
    .where(and(eq(writeLog.userId, userId), eq(writeLog.action, 'mark_watched'), gt(writeLog.at, since(365))))
    .all()
  const count = (source: string, days: number, result: 'ok' | 'error' = 'ok') =>
    rows.filter(r => r.source === source && r.result === result && r.at.getTime() > since(days).getTime()).length
  return (['trakt', 'simkl', 'mal'] as const).map(source => ({
    source,
    week: count(source, 7),
    month: count(source, 30),
    year: count(source, 365),
    failed: count(source, 30, 'error')
  }))
}
