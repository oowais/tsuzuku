import { isDemo } from '../../demo'
import { useBackups } from '../../lib/backup-service'

// The nightly backup (decision #18): the same copy as "Back up now", which keeps the newest 14. Local only,
// never a source call. Not in demo mode, whose database is fictional. Every outcome is a `[backup]` line in
// the container log (`docker compose logs tsuzuku | grep backup`).
export default defineTask({
  meta: { name: 'backup:nightly', description: 'Back up the database' },
  async run() {
    if (isDemo()) {
      console.info('[backup] nightly skipped in demo mode')
      return { result: 'skipped' }
    }
    const backups = useBackups()
    try {
      const before = backups.list().map(b => b.name)
      const backup = await backups.create()
      const after = new Set(backups.list().map(b => b.name))
      console.info(`[backup] nightly ${backup.name} (${backup.size} bytes), ${after.size} kept`)
      for (const name of before.filter(n => !after.has(n))) console.info(`[backup] nightly removed ${name}`)
      return { result: backup.name }
    } catch (e) {
      console.error(`[backup] nightly failed: ${(e as Error).message}`)
      return { result: 'failed' }
    }
  }
})
