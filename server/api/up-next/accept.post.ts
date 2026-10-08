import { z } from 'zod'
import { useDb } from '../../db'
import { createAcceptedStore } from '../../lib/accepted-store'

const body = z.object({ rowKey: z.string().min(1), signature: z.string().min(1) })

// "Accept this difference": stored with the positions you saw, so it comes back when any source moves.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  createAcceptedStore(useDb()).accept(input.rowKey, input.signature)
  return { ok: true }
})
