import { appUrl, ConfigError } from '../../../lib/env'
import { STATE_TTL_MS, useOAuth } from '../../../lib/oauth'
import { isOAuthSource } from '../../../lib/oauth/providers'

export default defineEventHandler((event) => {
  const source = getRouterParam(event, 'source')
  if (!isOAuthSource(source)) throw createError({ statusCode: 404, statusMessage: 'Unknown source' })

  try {
    const { url, state } = useOAuth().start(source)
    // Binds the flow to this browser; the callback must present the same state.
    setCookie(event, `tsuzuku_oauth_${source}`, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: appUrl().startsWith('https://'),
      path: `/api/auth/${source}`,
      maxAge: STATE_TTL_MS / 1000
    })
    return sendRedirect(event, url)
  } catch (err) {
    if (err instanceof ConfigError) return sendRedirect(event, `/settings?source=${source}&error=config_missing`)
    throw err
  }
})
