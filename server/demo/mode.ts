// Demo mode: the app runs on fictional shows and fake source answers, for trying the UI without real
// accounts (`bun run dev:demo`). Nothing reaches Trakt, Simkl, MAL or AniList, no token is stored, and
// the database is a separate file. It refuses to run in production.

export const DEMO_DATABASE_PATH = '.data/demo.db'

export function isDemo(env = process.env): boolean {
  return env.TSUZUKU_DEMO === '1'
}

export function assertDemoAllowed(env = process.env) {
  if (isDemo(env) && env.NODE_ENV === 'production') {
    throw new Error('TSUZUKU_DEMO is set in production; demo mode is for local development only')
  }
}
