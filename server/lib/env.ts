import { z } from 'zod'
import type { OAuthSource } from './oauth/providers'

// Environment is read at call time (not at build time) so the same build runs anywhere.

export class ConfigError extends Error {}

const nonEmpty = z.string().trim().min(1)

export function appUrl(env = process.env): string {
  const parsed = z.url().safeParse(env.APP_URL || 'http://localhost:3000')
  if (!parsed.success) throw new ConfigError('APP_URL must be a full URL, for example http://localhost:3000')
  return parsed.data.replace(/\/+$/, '')
}

export interface ClientCredentials {
  clientId: string
  clientSecret: string
}

export function clientCredentials(source: OAuthSource, env = process.env): ClientCredentials {
  const prefix = source.toUpperCase()
  const clientId = nonEmpty.safeParse(env[`${prefix}_CLIENT_ID`])
  const clientSecret = nonEmpty.safeParse(env[`${prefix}_CLIENT_SECRET`])
  if (!clientId.success || !clientSecret.success) throw new ConfigError(`${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be set`)
  return { clientId: clientId.data, clientSecret: clientSecret.data }
}
