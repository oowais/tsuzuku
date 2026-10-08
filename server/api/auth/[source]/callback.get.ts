import { ConfigError } from '../../../lib/env'
import { OAuthFlowError, useOAuth } from '../../../lib/oauth'
import { isOAuthSource } from '../../../lib/oauth/providers'

export default defineEventHandler(async (event) => {
  const source = getRouterParam(event, 'source')
  if (!isOAuthSource(source)) throw createError({ statusCode: 404, statusMessage: 'Unknown source' })

  const cookieName = `tsuzuku_oauth_${source}`
  const cookieState = getCookie(event, cookieName)
  deleteCookie(event, cookieName, { path: `/api/auth/${source}` })

  const query = getQuery(event)
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

  try {
    await useOAuth().complete(source, { code: str(query.code), state: str(query.state), error: str(query.error) }, cookieState)
    return sendRedirect(event, `/settings?connected=${source}`)
  } catch (err) {
    // Error codes only in the URL; never tokens or provider messages.
    const code = err instanceof OAuthFlowError ? err.code : err instanceof ConfigError ? 'config_missing' : 'exchange_failed'
    console.error(`[oauth] ${source} callback failed: ${err instanceof Error ? err.message : String(err)}`)
    return sendRedirect(event, `/settings?source=${source}&error=${code}`)
  }
})
