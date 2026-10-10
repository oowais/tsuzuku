import { and, eq, isNotNull } from 'drizzle-orm'
import { useDb } from '../db'
import { mappings } from '../db/schema'
import { loadUpNextCached } from '../lib/up-next-service'
import { createWriteLog, logLinks, type WriteLogItem } from '../lib/write-log'
import { USER_ID } from '../lib/user'

// The write log, newest first, with links to each source's item and episode, and the show's poster.
export default defineEventHandler(() => {
  const db = useDb()
  const slugs = new Map(db.select({ id: mappings.traktId, slug: mappings.traktSlug }).from(mappings)
    .where(and(eq(mappings.userId, USER_ID), isNotNull(mappings.traktSlug))).all().map(m => [m.id, m.slug!]))
  const entries = createWriteLog(db).recent()
  // Entries logged before images were stored (#88) borrow the poster of a later write for the same row, else
  // the row's poster on Up Next as last read (no source calls). A show no longer on Up Next keeps a blank tile.
  const posters = new Map<string, string[]>()
  for (const r of entries) {
    const item = r.item as Partial<WriteLogItem>
    if (item.rowKey && item.images?.length && !posters.has(item.rowKey)) posters.set(item.rowKey, item.images)
  }
  for (const row of loadUpNextCached() ?? []) if (row.images.length && !posters.has(row.key)) posters.set(row.key, row.images)
  return entries.map((r) => {
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
      images: item.images?.length ? item.images : posters.get(item.rowKey ?? '') ?? [],
      result: r.result,
      error: r.error
    }
  })
})
