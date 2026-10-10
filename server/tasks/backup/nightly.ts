import { isDemo } from '../../demo'
import { useBackups } from '../../lib/backup-service'

// The nightly backup (decision #18): the same copy as "Back up now", which keeps the newest 14. Local only,
// never a source call. Not in demo mode, whose database is fictional.
export default defineTask({
  meta: { name: 'backup:nightly', description: 'Back up the database' },
  async run() {
    if (isDemo()) return { result: 'skipped in demo mode' }
    const backup = await useBackups().create()
    console.info(`[backup] nightly ${backup.name} (${backup.size} bytes)`)
    return { result: backup.name }
  }
})
