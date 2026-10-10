import { useDb } from '../db'
import { applyDemoEnv, assertDemoAllowed, isDemo, useDemoSources } from '../demo'
import { seedDemo } from '../demo/seed'
import { useAccessVerifier } from '../lib/access'
import { useSourceWrapper } from '../lib/source-wrapper'
import { runningCommit } from '../lib/version'

// Open the database and run migrations at startup, so a bad migration fails fast. In demo mode, refuse
// production, then fill the separate demo database. In production, refuse to start without the Access check.
export default defineNitroPlugin(() => {
  assertDemoAllowed()
  useAccessVerifier()
  if (isDemo()) applyDemoEnv()
  const db = useDb()
  // Which build is running, so the log answers "is the fix deployed?" (#92).
  console.info(`[tsuzuku] started, commit ${runningCommit()}, database ${process.env.DATABASE_PATH ?? 'default'}`)
  if (isDemo()) {
    seedDemo(db, useSourceWrapper(), useDemoSources())
    console.info('[demo] Demo mode: fictional shows, fake sources, database .data/demo.db')
  }
})
