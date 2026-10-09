// Copies the SQLite database with SQLite's online backup, safe while the app is writing, and keeps the
// newest BACKUP_KEEP copies (default 14). The token encryption key is not in the copy: keep it separately.
//
// In the container:  docker compose exec -T tsuzuku node scripts/backup.mjs
// Locally:           node scripts/backup.mjs
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

// better-sqlite3 from the built server in the image, else from the project's node_modules.
function loadSqlite() {
  try {
    return createRequire(new URL('../.output/server/index.mjs', import.meta.url))('better-sqlite3')
  } catch {
    return createRequire(import.meta.url)('better-sqlite3')
  }
}

const dbPath = resolve(process.env.DATABASE_PATH || '.data/tsuzuku.db')
const dir = resolve(process.env.BACKUP_DIR || join(dirname(dbPath), 'backups'))
const keep = Number(process.env.BACKUP_KEEP || 14)

const Database = loadSqlite()
const db = new Database(dbPath, { fileMustExist: true, readonly: true })
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const target = join(dir, `tsuzuku-${stamp}.db`)
await db.backup(target)
db.close()
console.log(`backup: ${target}`)

const old = readdirSync(dir).filter(f => /^tsuzuku-.*\.db$/.test(f)).sort().reverse().slice(keep)
for (const f of old) {
  rmSync(join(dir, f))
  console.log(`backup: removed ${f}`)
}
