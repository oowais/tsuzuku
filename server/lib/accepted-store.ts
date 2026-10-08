import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { acceptedDifferences } from '../db/schema'
import { USER_ID } from './user'

// The ignore list for Up Next: a difference you accepted, keyed by row and stored with the row's
// signature. It only applies while the signature matches, so any change brings the flag back. Local
// database only; nothing here touches a source.
export function createAcceptedStore(db: Db, userId = USER_ID) {
  function all(): Record<string, string> {
    const rows = db.select().from(acceptedDifferences).where(eq(acceptedDifferences.userId, userId)).all()
    return Object.fromEntries(rows.map(r => [r.rowKey, r.signature]))
  }

  // One acceptance per row: accepting again replaces the stored signature.
  function accept(rowKey: string, signature: string) {
    db.insert(acceptedDifferences).values({ userId, rowKey, signature })
      .onConflictDoUpdate({ target: [acceptedDifferences.userId, acceptedDifferences.rowKey], set: { signature, createdAt: new Date() } })
      .run()
  }

  function undo(rowKey: string) {
    db.delete(acceptedDifferences).where(and(eq(acceptedDifferences.userId, userId), eq(acceptedDifferences.rowKey, rowKey))).run()
  }

  return { all, accept, undo }
}
