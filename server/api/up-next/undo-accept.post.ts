import { z } from 'zod'
import { useDb } from '../../db'
import { createAcceptedStore } from '../../lib/accepted-store'

const body = z.object({ rowKey: z.string().min(1) })

// Flag the difference again.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  createAcceptedStore(useDb()).undo(input.rowKey)
  return { ok: true }
})
