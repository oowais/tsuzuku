import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

// Cloudflare Access check (docs/decisions.md #17). Access signs every request it lets through with a JWT in
// the Cf-Access-Jwt-Assertion header. Checking it here means a request that reaches the container any
// other way (another container on the network, a stray tunnel route, a deleted Access app) gets a 403.

export const ACCESS_HEADER = 'cf-access-jwt-assertion'

// Reached without the header: the container health check calls it from inside the container.
export const ACCESS_EXEMPT = ['/api/health']

export interface AccessConfig {
  // https://<team>.cloudflareaccess.com, the token issuer.
  issuer: string
  // The Access application's AUD tag.
  aud: string
}

// From CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD. Off (null) outside production unless both are set; in
// production a missing value stops the server, so the check can never switch off silently.
export function accessConfig(env = process.env): AccessConfig | null {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim()
  const aud = env.CF_ACCESS_AUD?.trim()
  if (!team || !aud) {
    if (env.NODE_ENV === 'production') throw new Error('Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD in .env: the app checks every request came through Cloudflare Access')
    return null
  }
  const host = team.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return { issuer: `https://${host}`, aud }
}

export type AccessResult = { ok: true, email: string | null } | { ok: false, reason: string }

export function createAccessVerifier(config: AccessConfig, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`))) {
  return async (token: string | undefined): Promise<AccessResult> => {
    if (!token) return { ok: false, reason: 'no Access token' }
    try {
      const { payload } = await jwtVerify(token, keys, { issuer: config.issuer, audience: config.aud })
      return { ok: true, email: typeof payload.email === 'string' ? payload.email : null }
    } catch (e) {
      return { ok: false, reason: (e as { code?: string }).code ?? 'invalid Access token' }
    }
  }
}

let verifier: ReturnType<typeof createAccessVerifier> | null | undefined

// The verifier for this process, or null when the check is off. The signing keys are fetched once and
// refetched by jose when Access rotates them.
export function useAccessVerifier() {
  if (verifier === undefined) {
    const config = accessConfig()
    verifier = config && createAccessVerifier(config)
  }
  return verifier
}
