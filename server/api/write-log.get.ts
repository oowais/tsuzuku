import { useDb } from '../db'
import { createWriteLog, type WriteLogItem } from '../lib/write-log'

// The write log, newest first.
export default defineEventHandler(() => createWriteLog(useDb()).recent().map((r) => {
  const item = r.item as Partial<WriteLogItem>
  return {
    id: r.id,
    at: r.at,
    source: r.source,
    action: r.action,
    title: item.title ?? '',
    episode: item.episode ?? '',
    summary: item.summary ?? '',
    result: r.result,
    error: r.error
  }
}))
