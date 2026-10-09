import { z } from 'zod'
import { useDb } from '../../db'
import { createDismissedStore } from '../../lib/dismissed-store'

const body = z.object({ malId: z.number().int().positive() })

// Bring a dismissed sequel back.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  createDismissedStore(useDb()).undo(input.malId)
  return { ok: true }
})
