import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../server/db'

const dir = mkdtempSync(join(tmpdir(), 'tsuzuku-db-'))
const db = createDb(join(dir, 'test.db'))
const sqlite = db.$client

afterAll(() => {
  sqlite.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createDb', () => {
  it('opens in WAL mode with foreign keys on', () => {
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('creates every table with a user_id column', () => {
    const tables = sqlite
      .prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'`)
      .all() as { name: string }[]
    expect(tables.map(t => t.name).sort()).toEqual([
      'accepted_differences', 'fetch_cache', 'mapping_seasons', 'mappings', 'metadata_cache',
      'oauth_states', 'rejected_candidates', 'source_accounts', 'write_log'
    ])
    for (const { name } of tables) {
      const cols = sqlite.pragma(`table_info(${name})`) as { name: string }[]
      expect(cols.map(c => c.name), name).toContain('user_id')
    }
  })
})

describe('accepted differences', () => {
  it('stores one signature per row, replaces it on accept and removes it on undo', async () => {
    const { createAcceptedStore } = await import('../server/lib/accepted-store')
    const store = createAcceptedStore(db)
    store.accept('m:1', 'a')
    store.accept('m:1', 'b')
    store.accept('t:2', 'c')
    expect(store.all()).toEqual({ 'm:1': 'b', 't:2': 'c' })
    store.undo('m:1')
    expect(store.all()).toEqual({ 't:2': 'c' })
    expect(createAcceptedStore(db, 2).all()).toEqual({})
  })
})
