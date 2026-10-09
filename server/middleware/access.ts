import { ACCESS_EXEMPT, ACCESS_HEADER, useAccessVerifier } from '../lib/access'

// Every request must carry a valid Cloudflare Access token (server/lib/access.ts). Off in local dev.
export default defineEventHandler(async (event) => {
  const verify = useAccessVerifier()
  if (!verify || ACCESS_EXEMPT.includes(event.path.split('?')[0]!)) return
  const result = await verify(getHeader(event, ACCESS_HEADER))
  if (!result.ok) {
    // The reason only; never the token.
    console.warn(`[access] Refused ${event.method} ${event.path}: ${result.reason}`)
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
})
