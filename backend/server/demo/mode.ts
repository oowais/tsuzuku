// Demo mode: the app runs on fictional shows and fake source answers, for trying the UI without real
// accounts (`vp run dev:demo`). Nothing reaches Trakt, Simkl, MAL or AniList, no token is stored, and
// the database is a separate file. It refuses to run in production.

export const DEMO_DATABASE_PATH = ".data/demo.db";

// The fixture recorder (scripts/record-fixtures.mjs) runs its own demo instance on a fresh file
// (TSUZUKU_DEMO_DB). Whatever it says, the file must be named demo*.db, so it can never be the real database.
export function demoDatabasePath(env = process.env): string {
  const path = env.TSUZUKU_DEMO_DB || DEMO_DATABASE_PATH;
  if (!/(^|\/)demo[\w-]*\.db$/.test(path))
    throw new Error(`TSUZUKU_DEMO_DB must name a demo*.db file, not ${path}`);
  return path;
}

export function isDemo(env = process.env): boolean {
  return env.TSUZUKU_DEMO === "1";
}

export function assertDemoAllowed(env = process.env) {
  if (isDemo(env) && env.NODE_ENV === "production") {
    throw new Error("TSUZUKU_DEMO is set in production; demo mode is for local development only");
  }
}
