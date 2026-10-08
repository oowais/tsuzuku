import type { ClientCredentials } from '../env'

// OAuth details per source, taken from each source's official docs (checked 2026-10-08):
// - Trakt: https://trakt.docs.apiary.io/#reference/authentication-oauth
// - Simkl: https://simkl.docs.apiary.io/#reference/authentication-oauth-2.0
// - MAL:   https://myanimelist.net/apiconfig/references/authorization
// Token lifetimes are never hardcoded: expiry comes from `expires_in` in the real response
// (Trakt's docs say 7 days in prose but show expires_in 86400; Simkl tokens never expire).

export const OAUTH_SOURCES = ['trakt', 'simkl', 'mal'] as const
export type OAuthSource = (typeof OAUTH_SOURCES)[number]

export const USER_AGENT = 'Tsuzuku/0.1'

export interface OAuthProvider {
  authorizeUrl: string
  tokenUrl: string
  // MAL supports only the `plain` PKCE method.
  pkce: boolean
  // Trakt and Simkl take JSON, MAL takes form encoding.
  bodyFormat: 'json' | 'form'
  headers: (creds: ClientCredentials) => Record<string, string>
  supportsRefresh: boolean
}

export const PROVIDERS: Record<OAuthSource, OAuthProvider> = {
  trakt: {
    authorizeUrl: 'https://trakt.tv/oauth/authorize',
    tokenUrl: 'https://api.trakt.tv/oauth/token',
    pkce: false,
    bodyFormat: 'json',
    headers: ({ clientId }) => ({ 'trakt-api-key': clientId, 'trakt-api-version': '2' }),
    supportsRefresh: true
  },
  simkl: {
    authorizeUrl: 'https://simkl.com/oauth/authorize',
    tokenUrl: 'https://api.simkl.com/oauth/token',
    pkce: false,
    bodyFormat: 'json',
    headers: ({ clientId }) => ({ 'simkl-api-key': clientId }),
    supportsRefresh: false
  },
  mal: {
    authorizeUrl: 'https://myanimelist.net/v1/oauth2/authorize',
    tokenUrl: 'https://myanimelist.net/v1/oauth2/token',
    pkce: true,
    bodyFormat: 'form',
    headers: () => ({}),
    supportsRefresh: true
  }
}

export function isOAuthSource(value: unknown): value is OAuthSource {
  return typeof value === 'string' && (OAUTH_SOURCES as readonly string[]).includes(value)
}
