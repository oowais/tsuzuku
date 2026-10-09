import { and, eq, isNotNull } from 'drizzle-orm'
import { useDb } from '../db'
import { mappings } from '../db/schema'
import { createWriteLog, logLinks, type WriteLogItem } from '../lib/write-log'
import { USER_ID } from '../lib/user'

// The write log, newest first, with links to each source's item and episode.
export default defineEventHandler(() => {
  const db = useDb()
  const slugs = new Map(db.select({ id: mappings.traktId, slug: mappings.traktSlug }).from(mappings)
    .where(and(eq(mappings.userId, USER_ID), isNotNull(mappings.traktSlug))).all().map(m => [m.id, m.slug!]))
  return createWriteLog(db).recent().map((r) => {
    const item = r.item as Partial<WriteLogItem>
    return {
      ...logLinks(r.source, item, id => slugs.get(id)),
      id: r.id,
      at: r.at,
      source: r.source,
      action: r.action,
      rowKey: item.rowKey ?? '',
      markId: item.markId ?? null,
      title: item.title ?? '',
      episode: item.episode ?? '',
      summary: item.summary ?? '',
      listStatus: item.listStatus ?? null,
      result: r.result,
      error: r.error
    }
  })
})
