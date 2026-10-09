import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createDb } from '../server/db'
import { mappings } from '../server/db/schema'
import { backupDir, createBackups } from '../server/lib/backup'
import { USER_ID } from '../server/lib/user'

let dir: string
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function setup(keep = 14) {
  dir = mkdtempSync(join(tmpdir(), 'tsuzuku-backup-'))
  const db = createDb(join(dir, 'tsuzuku.db'))
  db.insert(mappings).values({ userId: USER_ID, kind: 'show', traktId: 7, status: 'confirmed' }).run()
  let t = Date.UTC(2026, 9, 9, 12)
  const backups = createBackups(db, join(dir, 'backups'), { keep, now: () => new Date(t += 1000) })
  return { db, backups }
}

describe('in-app backups', () => {
  it('copies the database, readable on its own', async () => {
    const { backups } = setup()
    const b = await backups.create()
    expect(b.name).toBe('tsuzuku-2026-10-09T12-00-01-000Z.db')
    const copy = new Database(join(dir, 'backups', b.name), { readonly: true })
    expect(copy.prepare('select trakt_id from mappings').all()).toEqual([{ trakt_id: 7 }])
    copy.close()
    expect(backups.list().map(x => x.name)).toEqual([b.name])
  })

  it('keeps only the newest ones', async () => {
    const { backups } = setup(2)
    for (let i = 0; i < 3; i++) await backups.create()
    expect(backups.list().map(b => b.name)).toEqual(['tsuzuku-2026-10-09T12-00-03-000Z.db', 'tsuzuku-2026-10-09T12-00-02-000Z.db'])
  })

  it('serves only a listed backup by name, never another file or path', async () => {
    const { backups } = setup()
    const b = await backups.create()
    writeFileSync(join(dir, 'backups', 'notes.txt'), 'x')
    expect(backups.file(b.name)).toBe(join(dir, 'backups', b.name))
    for (const name of ['../tsuzuku.db', 'tsuzuku.db', 'notes.txt', '../../.env', `../backups/${b.name}`, 'tsuzuku-2026-10-09T12-00-09-000Z.db', '']) {
      expect(backups.file(name)).toBeNull()
    }
  })

  it('keeps demo backups apart from real ones', () => {
    expect(backupDir('/x/.data/tsuzuku.db', {})).toBe('/x/.data/backups')
    expect(backupDir('/x/.data/demo.db', {}, true)).toBe('/x/.data/demo-backups')
    expect(backupDir('/data/tsuzuku.db', { BACKUP_DIR: '/b' })).toBe('/b')
  })
})
