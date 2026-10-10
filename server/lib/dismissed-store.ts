import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { dismissedSequels } from '../db/schema'
import { USER_ID } from './user'

// The sequels on Coming back you do not care about (#66), by MAL ID. Local database only.
export function createDismissedStore(db: Db, userId = USER_ID) {
  function all(): Set<number> {
    return new Set(db.select().from(dismissedSequels).where(eq(dismissedSequels.userId, userId)).all().map(r => r.malId))
  }

  function dismiss(malId: number) {
    db.insert(dismissedSequels).values({ userId, malId }).onConflictDoNothing().run()
  }

  function undo(malId: number) {
    db.delete(dismissedSequels).where(and(eq(dismissedSequels.userId, userId), eq(dismissedSequels.malId, malId))).run()
  }

  return { all, dismiss, undo }
}
