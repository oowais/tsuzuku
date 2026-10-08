import type { ClientCredentials } from '../env'

// OAuth details per source, taken from each source's official docs (checked 2026-10-08):
// - Trakt: https://trakt.docs.apiary.io/#reference/authentication-oauth, plus the PKCE guide in the
//   new developer portal (2026-10-08): new apps get no client secret and must use PKCE with S256.
// - Simkl: AUTH V2, https://api.simkl.org/api-reference/auth-v2 (V1 retires around April 2027).
//   Registered as "Server apps & services": secret plus PKCE S256, 7-day access tokens,
//   non-rotating refresh tokens.
// - MAL:   https://myanimelist.net/apiconfig/references/authorization
// Token lifetimes are never hardcoded: expiry comes from `expires_in` in the real response
// (Trakt's docs say 7 days in prose but show expires_in 86400).

export const OAUTH_SOURCES = ['trakt', 'simkl', 'mal'] as const
export type OAuthSource = (typeof OAUTH_SOURCES)[number]

export const APP_NAME = 'tsuzuku'
export const APP_VERSION = '0.1'
export const USER_AGENT = `Tsuzuku/${APP_VERSION}`

export interface OAuthProvider {
  authorizeUrl: string
  tokenUrl: string
  // Trakt supports only S256, MAL only `plain`. Null means no PKCE.
  pkce: 'S256' | 'plain' | null
  // Trakt's PKCE apps have no secret and must not send one.
  usesClientSecret: boolean
  // Trakt and Simkl take JSON, MAL takes form encoding.
  bodyFormat: 'json' | 'form'
  headers: (creds: ClientCredentials) => Record<string, string>
  // Space-separated scopes for the authorize URL, when the source has them.
  scope?: string
}

export const PROVIDERS: Record<OAuthSource, OAuthProvider> = {
  trakt: {
    authorizeUrl: 'https://auth.trakt.tv/oauth/authorize',
    tokenUrl: 'https://api.trakt.tv/oauth/token',
    pkce: 'S256',
    usesClientSecret: false,
    bodyFormat: 'json',
    headers: ({ clientId }) => ({ 'trakt-api-key': clientId, 'trakt-api-version': '2' })
  },
  simkl: {
    authorizeUrl: 'https://simkl.com/oauth2/authorize',
    tokenUrl: 'https://api.simkl.com/oauth2/token',
    pkce: 'S256',
    usesClientSecret: true,
    bodyFormat: 'json',
    headers: ({ clientId }) => ({ 'simkl-api-key': clientId }),
    // media:write is needed to mark episodes watched. Simkl silently downgrades to read-only on
    // a misspelled scope, so the granted scope is logged on every token response.
    scope: 'media:read media:write'
  },
  mal: {
    authorizeUrl: 'https://myanimelist.net/v1/oauth2/authorize',
    tokenUrl: 'https://myanimelist.net/v1/oauth2/token',
    pkce: 'plain',
    usesClientSecret: true,
    bodyFormat: 'form',
    headers: () => ({})
  }
}

export function isOAuthSource(value: unknown): value is OAuthSource {
  return typeof value === 'string' && (OAUTH_SOURCES as readonly string[]).includes(value)
}
