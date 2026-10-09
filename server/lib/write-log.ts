import { and, desc, eq, gt } from 'drizzle-orm'
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
}

export function createWriteLog(db: Db, userId = USER_ID) {
  function add(source: Source, action: string, item: WriteLogItem, error: string | null) {
    db.insert(writeLog).values({ userId, source, action, item, result: error ? 'error' : 'ok', error, at: new Date() }).run()
  }

  function recent(limit = 200) {
    return db.select().from(writeLog).where(eq(writeLog.userId, userId)).orderBy(desc(writeLog.at), desc(writeLog.id)).limit(limit).all()
  }

  // A write the source took recently for the same row and starting point. Re-reading the source cannot rule
  // this out on its own: a source may be slow to show the change, and Trakt does not reject duplicate plays.
  function recentSuccess(source: Source, rowKey: string, expected: string, withinMs = 24 * 60 * 60 * 1000) {
    const rows = db.select().from(writeLog)
      .where(and(eq(writeLog.userId, userId), eq(writeLog.source, source), eq(writeLog.result, 'ok'), gt(writeLog.at, new Date(Date.now() - withinMs))))
      .orderBy(desc(writeLog.at)).all()
    return rows.find((r) => {
      const item = r.item as Partial<WriteLogItem>
      return item.rowKey === rowKey && item.expected === expected
    }) ?? null
  }

  return { add, recent, recentSuccess }
}
