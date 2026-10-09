import type { AccessTokenResult } from '../lib/oauth'
import { createDemoSources } from './fake-sources'

export { DEMO_DATABASE_PATH, assertDemoAllowed, isDemo } from './mode'

type Host = 'trakt' | 'simkl' | 'mal' | 'anilist'

let sources: ReturnType<typeof createDemoSources> | undefined

// The one fake source server for this process. DEMO_FAIL=mal,simkl makes those answer with rate limits.
export function useDemoSources() {
  const fail = (process.env.DEMO_FAIL ?? '').split(',').map(s => s.trim()).filter((s): s is Host => ['trakt', 'simkl', 'mal', 'anilist'].includes(s))
  sources ??= createDemoSources({ fail })
  return sources
}

// Every source counts as connected; the token is a placeholder the fake sources accept and nothing stores.
export const demoOAuth = {
  getAccessToken: async (): Promise<AccessTokenResult> => ({ ok: true, token: 'demo' })
}

// Client IDs the adapters require, so demo mode runs without a filled-in .env. They never leave the machine.
export function applyDemoEnv(env = process.env) {
  for (const key of ['TRAKT_CLIENT_ID', 'SIMKL_CLIENT_ID', 'SIMKL_CLIENT_SECRET', 'MAL_CLIENT_ID', 'MAL_CLIENT_SECRET']) env[key] = 'demo'
}
