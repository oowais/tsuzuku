import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { accessConfig, createAccessVerifier, isAccessExempt } from '../server/lib/access'

const config = { issuer: 'https://team.cloudflareaccess.com', aud: 'aud-tag' }

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
  const sign = (claims: { iss?: string, aud?: string, exp?: string } = {}) =>
    new SignJWT({ email: 'me@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(claims.iss ?? config.issuer)
      .setAudience(claims.aud ?? config.aud)
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? '1h')
      .sign(privateKey)
  return { jwks: createLocalJWKSet({ keys: [jwk] }), sign }
}

describe('Cloudflare Access check', () => {
  it('is required in production and off in dev unless configured', () => {
    expect(() => accessConfig({ NODE_ENV: 'production' })).toThrow('CF_ACCESS_TEAM_DOMAIN')
    expect(() => accessConfig({ NODE_ENV: 'production', CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' })).toThrow()
    expect(accessConfig({ NODE_ENV: 'development' })).toBeNull()
    expect(accessConfig({ CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/', CF_ACCESS_AUD: ' aud-tag ' })).toEqual(config)
    expect(accessConfig({ CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' })).toEqual(config)
  })

  it('accepts a token Access signed for this app', async () => {
    const { jwks, sign } = await keys()
    expect(await createAccessVerifier(config, jwks)(await sign())).toEqual({ ok: true, email: 'me@example.com' })
  })

  it('refuses a missing, foreign, expired or forged token', async () => {
    const { jwks, sign } = await keys()
    const verify = createAccessVerifier(config, jwks)
    expect(await verify(undefined)).toEqual({ ok: false, reason: 'no Access token' })
    expect(await verify(await sign({ aud: 'other-app' }))).toMatchObject({ ok: false })
    expect(await verify(await sign({ iss: 'https://other.cloudflareaccess.com' }))).toMatchObject({ ok: false })
    expect(await verify(await sign({ exp: '-1m' }))).toMatchObject({ ok: false, reason: 'ERR_JWT_EXPIRED' })
    const forged = await (await keys()).sign()
    expect(await verify(forged)).toMatchObject({ ok: false })
    expect(await verify('not-a-jwt')).toMatchObject({ ok: false })
  })
  it('lets only the health check and icon lookups through without a token', () => {
    expect(isAccessExempt('/api/health')).toBe(true)
    expect(isAccessExempt('/api/_nuxt_icon/lucide.json?icons=link')).toBe(true)
    expect(isAccessExempt('/')).toBe(false)
    expect(isAccessExempt('/api/up-next')).toBe(false)
    expect(isAccessExempt('/api/health/../up-next')).toBe(false)
    expect(isAccessExempt('/api/healthz')).toBe(false)
    expect(isAccessExempt('/api/_nuxt_icon/../up-next')).toBe(false)
    expect(isAccessExempt('/api/_nuxt_icon/%2E%2E/up-next')).toBe(false)
  })
})
