import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Db } from '../db'

// In-app backups (Settings): the same copy as scripts/backup.mjs, SQLite's online backup, safe while the app
// is writing, into the backups folder next to the database, keeping the newest few. Made on a click and
// nightly (server/tasks/backup/nightly.ts).
// The copy holds source tokens encrypted; TOKEN_ENC_KEY is never in it.

// Names this module and scripts/backup.mjs give a backup: `tsuzuku-<ISO time with : and . as ->.db`.
const NAME = /^tsuzuku-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/

export interface BackupFile {
  name: string
  size: number
  createdAt: Date
}

export function backupDir(dbPath: string, env = process.env, demo = false) {
  // Demo backups never land next to a real local database's.
  return env.BACKUP_DIR || join(dirname(dbPath), demo ? 'demo-backups' : 'backups')
}

export function createBackups(db: Db, dir: string, opts: { keep?: number, now?: () => Date } = {}) {
  const keep = opts.keep ?? 14
  const now = opts.now ?? (() => new Date())

  function list(): BackupFile[] {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return []
    }
    return names.filter(n => NAME.test(n)).sort().reverse().map((name) => {
      const st = statSync(join(dir, name))
      return { name, size: st.size, createdAt: st.mtime }
    })
  }

  async function create(): Promise<BackupFile> {
    mkdirSync(dir, { recursive: true })
    const name = `tsuzuku-${now().toISOString().replace(/[:.]/g, '-')}.db`
    await db.$client.backup(join(dir, name))
    for (const old of list().slice(keep)) rmSync(join(dir, old.name))
    return list().find(b => b.name === name)!
  }

  // The file for a download: only a name that is one of the backups listed right now. Anything else
  // (another file, a path, `..`) is null.
  function file(name: string): string | null {
    if (!NAME.test(name)) return null
    return list().some(b => b.name === name) ? join(dir, name) : null
  }

  return { list, create, file }
}
