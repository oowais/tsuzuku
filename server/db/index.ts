import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DEMO_DATABASE_PATH, isDemo } from '../demo/mode'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export const MIGRATIONS_DIR = resolve(process.env.MIGRATIONS_DIR || 'server/db/migrations')

// Opens a SQLite file (or ':memory:') in WAL mode and applies pending migrations.
export function createDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return db
}

let db: Db | undefined

// Demo mode always uses its own file, whatever DATABASE_PATH says, so it can never touch real data.
export function useDb(): Db {
  db ??= createDb(resolve(isDemo() ? DEMO_DATABASE_PATH : process.env.DATABASE_PATH || '.data/tsuzuku.db'))
  return db
}

export { schema }
