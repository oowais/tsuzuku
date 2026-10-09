import { sql } from 'drizzle-orm'
import { useDb } from '../db'

// For the container health check: the server answers and the database opens (migrations applied).
// Calls no source.
export default defineEventHandler(() => {
  useDb().get(sql`select 1`)
  return { ok: true }
})
