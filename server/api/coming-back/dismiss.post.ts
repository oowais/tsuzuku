import { z } from 'zod'
import { useDb } from '../../db'
import { createDismissedStore } from '../../lib/dismissed-store'

const body = z.object({ malId: z.number().int().positive() })

// Keep a sequel out of Coming back until undone.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  createDismissedStore(useDb()).dismiss(input.malId)
  return { ok: true }
})
