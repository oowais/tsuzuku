import { and, desc, eq, gt } from 'drizzle-orm'
import { episodeUrl, itemUrl, type EpisodeRef, type LinkTarget } from '../../shared/utils/source-links'
import type { Db } from '../db'
import { writeLog, type Source } from '../db/schema'
import { USER_ID } from './user'

// Every confirmed write, whether the source took it or not. `item` says what was asked of which show.
export interface WriteLogItem {
  rowKey: string
  title: string
  episode: string
  summary: string
  expected: string
  write: unknown
  // Where the source says the item is afterwards (Simkl, MAL), e.g. completed; also when the source moved it itself.
  listStatus?: string | null
  // The same for every write of one confirm, so the Log page shows them as one mark (#74).
  markId?: string
  // The source's item and episode, for links on the Log page. Older entries are linked from `write` instead.
  link?: { target: LinkTarget, episode: EpisodeRef }
  // The row's poster URLs at the time, best first, for the Log page (#88).
  images?: string[]
}

export function createWriteLog(db: Db, userId = USER_ID) {
  function add(source: Source, action: string, item: WriteLogItem, error: string | null) {
    db.insert(writeLog).values({ userId, source, action, item, result: error ? 'error' : 'ok', error, at: new Date() }).run()
    // Writes are the riskiest thing the app does: each one in the docker log too (#92), not only on the Log page.
    const what = `[write] ${source} ${action} "${item.title}" ${item.episode}`.trimEnd()
    if (error) console.warn(`${what}: failed: ${error}`)
    else console.info(`${what}: ok`)
  }

  function recent(limit = 200) {
    return db.select().from(writeLog).where(eq(writeLog.userId, userId)).orderBy(desc(writeLog.at), desc(writeLog.id)).limit(limit).all()
  }

  // A write the source took recently for the same row and starting point. Re-reading the source cannot rule
  // this out on its own: a source may be slow to show the change, and Trakt does not reject duplicate plays.
  function recentSuccess(source: Source, rowKey: string, expected: string, withinMs = 24 * 60 * 60 * 1000) {
    const rows = db.select().from(writeLog)
      .where(and(eq(writeLog.userId, userId), eq(writeLog.source, source), eq(writeLog.action, 'mark_watched'), eq(writeLog.result, 'ok'), gt(writeLog.at, new Date(Date.now() - withinMs))))
      .orderBy(desc(writeLog.at)).all()
    return rows.find((r) => {
      const item = r.item as Partial<WriteLogItem>
      return item.rowKey === rowKey && item.expected === expected
    }) ?? null
  }

  // The newest mark of a row any source took within `withinMs`, for the preview's "changed since this page
  // loaded" note.
  function lastMark(rowKey: string, withinMs = 24 * 60 * 60 * 1000) {
    const rows = db.select().from(writeLog)
      .where(and(eq(writeLog.userId, userId), eq(writeLog.action, 'mark_watched'), eq(writeLog.result, 'ok'), gt(writeLog.at, new Date(Date.now() - withinMs))))
      .orderBy(desc(writeLog.at)).all()
    const hit = rows.find(r => (r.item as Partial<WriteLogItem>).rowKey === rowKey)
    return hit ? { episode: (hit.item as WriteLogItem).episode, at: hit.at } : null
  }

  // When the source last took a write, or null.
  function lastSuccessAt(source: Source): Date | null {
    return db.select({ at: writeLog.at }).from(writeLog)
      .where(and(eq(writeLog.userId, userId), eq(writeLog.source, source), eq(writeLog.result, 'ok')))
      .orderBy(desc(writeLog.at)).limit(1).get()?.at ?? null
  }

  return { add, recent, recentSuccess, lastMark, lastSuccessAt }
}

// Links for a log entry to the source's item and episode: from what the mark stored, or for entries logged
// before that, from the IDs in the write itself (a Trakt show by the slug of your link to it). No source calls.
export function logLinks(source: Source, item: Partial<WriteLogItem>, traktSlug: (traktId: number) => string | undefined) {
  const link = item.link ?? fromWrite(source, item.write, traktSlug)
  if (!link) return { url: null, episodeUrl: null }
  return { url: itemUrl(link.target), episodeUrl: episodeUrl(link.target, link.episode) }
}

function fromWrite(source: Source, write: unknown, traktSlug: (traktId: number) => string | undefined): WriteLogItem['link'] | null {
  const w = (write && typeof write === 'object' ? write : {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
  const season = num(w.season) ?? null
  if (source === 'trakt' && num(w.show) !== undefined && num(w.number) !== undefined) {
    const slug = traktSlug(num(w.show)!)
    return slug ? { target: { source, kind: 'show', ids: { traktSlug: slug } }, episode: { season, number: num(w.number)! } } : null
  }
  if (source === 'simkl' && num(w.simkl) !== undefined && num(w.number) !== undefined) {
    return { target: { source, kind: w.kind === 'anime' ? 'anime' : 'show', ids: { simkl: num(w.simkl) } }, episode: { season, number: num(w.number)! } }
  }
  // MAL stores the new watched count, which is the episode marked.
  if (source === 'mal' && num(w.mal) !== undefined && num(w.watched) !== undefined) {
    return { target: { source, kind: 'anime', ids: { mal: num(w.mal) } }, episode: { season: null, number: num(w.watched)! } }
  }
  return null
}
