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
      'accepted_differences', 'dismissed_sequels', 'fetch_cache', 'mapping_seasons', 'mappings', 'metadata_cache',
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

describe('write log', () => {
  it('finds a recent successful write for the same row and starting point only', async () => {
    const { createWriteLog } = await import('../server/lib/write-log')
    const log = createWriteLog(db)
    const item = { rowKey: 'm:1', title: 'Show', episode: 'S1E2', summary: '', expected: '1|1x2', write: {} }
    log.add('trakt', 'mark_watched', { ...item, rowKey: 'm:9' }, null)
    log.add('trakt', 'mark_watched', item, 'HTTP 500')
    expect(log.recentSuccess('trakt', 'm:1', '1|1x2')).toBeNull()
    log.add('trakt', 'mark_watched', item, null)
    expect(log.recentSuccess('trakt', 'm:1', '1|1x2')).not.toBeNull()
    expect(log.recentSuccess('simkl', 'm:1', '1|1x2')).toBeNull()
    expect(log.recentSuccess('trakt', 'm:1', '2|1x3')).toBeNull()
    expect(log.recent().map(r => r.result)).toEqual(['ok', 'error', 'ok'])
  })

  it('finds the newest mark of a row any source took, for the preview\'s changed note', async () => {
    const { createWriteLog } = await import('../server/lib/write-log')
    const log = createWriteLog(db)
    const item = { rowKey: 'm:5', title: 'Show', episode: 'S1E2', summary: '', expected: '1|1x2', write: {} }
    expect(log.lastMark('m:5')).toBeNull()
    log.add('simkl', 'mark_watched', item, 'HTTP 500')
    expect(log.lastMark('m:5')).toBeNull()
    log.add('trakt', 'mark_watched', item, null)
    expect(log.lastMark('m:5')).toMatchObject({ episode: 'S1E2' })
    expect(log.lastMark('m:6')).toBeNull()
  })
})
