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

// Watchlist statuses, one key for both Simkl and MAL, so each always has the same colour on the page.
export type ListKey = 'watching' | 'completed' | 'hold' | 'dropped' | 'plantowatch'
export interface Breakdown {
  title: string
  parts: { key: ListKey, label: string, value: number }[]
}

export interface SourceStats {
  source: StatsSource
  status: SourceResult<unknown>['status']
  stale: boolean
  fetchedAt: Date | null
  error: string | null
  // The few numbers the card leads with.
  headline: Figure[]
  // How the source's lists split up, per type.
  breakdowns: Breakdown[]
  // Everything else worth a number.
  more: Figure[]
  // Trakt only: how many ratings of 1 to 10 you gave.
  ratings: number[] | null
  // Trakt only: your episode history's total, first play and the last 32 days' watch times (#61).
  history: { total: number | null, first: string | null, recent: string[] } | null
  // Where the figures come from, when it is not the source's own stats.
  note: string | null
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

const LIST_LABELS: Record<ListKey, string> = { watching: 'Watching', completed: 'Completed', hold: 'On hold', dropped: 'Dropped', plantowatch: 'Plan to watch' }
// A breakdown from [key, value] pairs; left out when the source gave none of them.
function breakdown(title: string, list: [ListKey, unknown][]): Breakdown[] {
  const parts = list.flatMap(([key, v]) => {
    const value = num(v)
    return value === null ? [] : [{ key, label: LIST_LABELS[key], value }]
  })
  return parts.length ? [{ title, parts }] : []
}

type Read = Pick<SourceStats, 'headline' | 'breakdowns' | 'more' | 'ratings'> & { history?: SourceStats['history'] }

// Trakt: counted from your lists by the adapter (`TraktCounts`, #89), since Trakt's stats endpoint answers 204.
// Shows only; movies are out of scope (#90).
export function readTrakt(raw: unknown): Read {
  const r = obj(raw)
  const dist = obj(obj(r.ratings).distribution)
  const ratings = Array.from({ length: 10 }, (_, i) => num(dist[String(i + 1)]))
  return {
    headline: figures([['Shows watched', r.shows_watched], ['Show plays', r.show_plays]]),
    breakdowns: [],
    more: figures([['Ratings given', obj(r.ratings).total]]),
    ratings: ratings.every(n => n === null) ? null : ratings.map(n => n ?? 0),
    history: readHistory(r.history)
  }
}

function readHistory(v: unknown): SourceStats['history'] {
  const h = obj(v)
  if (!Array.isArray(h.recent)) return null
  return { total: num(h.total), first: typeof h.first === 'string' ? h.first : null, recent: h.recent.filter((t): t is string => typeof t === 'string') }
}

// Simkl /users/{id}/stats: { total_mins, tv: { total_mins, watching: { count, left_to_watch_episodes, ... },
// completed: { count }, ... }, anime: { ... }, movies: { ... }, watched_last_week: { total_mins } }.
export function readSimkl(raw: unknown): Read {
  const r = obj(raw)
  const tv = obj(r.tv)
  const anime = obj(r.anime)
  const movies = obj(r.movies)
  const lists = (block: Json, keys: ListKey[]) => keys.map((key): [ListKey, unknown] => [key, obj(block[key]).count])
  const ALL: ListKey[] = ['watching', 'completed', 'hold', 'dropped', 'plantowatch']
  const left = [obj(tv.watching).left_to_watch_episodes, obj(anime.watching).left_to_watch_episodes].map(num)
  return {
    headline: figures([['Time watched', r.total_mins, 'minutes'], ['Last week', obj(r.watched_last_week).total_mins, 'minutes']]),
    breakdowns: [...breakdown('TV', lists(tv, ALL)), ...breakdown('Anime', lists(anime, ALL)), ...breakdown('Movies', lists(movies, ['completed', 'dropped', 'plantowatch']))],
    more: figures([
      ['Time on TV', tv.total_mins, 'minutes'], ['Time on anime', anime.total_mins, 'minutes'], ['Time on movies', movies.total_mins, 'minutes'],
      ['Episodes left in Watching', left.every(n => n === null) ? null : left.reduce<number>((a, n) => a + (n ?? 0), 0)]
    ]),
    ratings: null
  }
}

// MAL /users/@me?fields=anime_statistics: { anime_statistics: { num_items_watching, ..., num_days_watched,
// num_episodes, mean_score, num_times_rewatched } }.
export function readMal(raw: unknown): Read {
  const s = obj(obj(raw).anime_statistics)
  return {
    headline: figures([['Days watched', s.num_days_watched, 'days'], ['Episodes', s.num_episodes], ['Mean score', s.mean_score, 'score']]),
    breakdowns: breakdown('Anime', [['watching', s.num_items_watching], ['completed', s.num_items_completed], ['hold', s.num_items_on_hold], ['dropped', s.num_items_dropped], ['plantowatch', s.num_items_plan_to_watch]]),
    more: figures([['Rewatched', s.num_times_rewatched]]),
    ratings: null
  }
}

const NOTES: Partial<Record<StatsSource, string>> = { trakt: 'Counted from your Trakt lists, shows only. Trakt\'s own stats are not available through its API.' }

const READERS: Record<StatsSource, (raw: unknown) => Read> = { trakt: readTrakt, simkl: readSimkl, mal: readMal }

// Only the statistics part of MAL's answer, which also carries the account's name and picture.
const rawPart = (source: StatsSource, data: unknown) => source === 'mal' ? obj(data).anime_statistics ?? null : data

export function summarize(source: StatsSource, res: SourceResult<unknown>): SourceStats {
  const read = res.data ? READERS[source](res.data) : { headline: [], breakdowns: [], more: [], ratings: null }
  return {
    source,
    status: res.status,
    stale: res.stale,
    fetchedAt: res.fetchedAt,
    error: res.status === 'ok' ? null : res.error ?? res.status,
    history: null,
    ...read,
    note: NOTES[source] ?? null,
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
  // The last 30 days, oldest first, each a 24-hour window ending `now` (no time zone to guess on the server).
  const days = (source: string) => Array.from({ length: 30 }, (_, i) => {
    const from = now - (30 - i) * DAY
    const inDay = rows.filter(r => r.source === source && r.at.getTime() > from && r.at.getTime() <= from + DAY)
    return { ok: inDay.filter(r => r.result === 'ok').length, failed: inDay.filter(r => r.result === 'error').length }
  })
  return (['trakt', 'simkl', 'mal'] as const).map(source => ({
    source,
    week: count(source, 7),
    month: count(source, 30),
    year: count(source, 365),
    failed: count(source, 30, 'error'),
    days: days(source)
  }))
}
