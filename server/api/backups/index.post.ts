import { useBackups } from '../../lib/backup-service'

// "Back up now" in Settings.
export default defineEventHandler(async () => {
  const backup = await useBackups().create()
  console.info(`[backup] ${backup.name} (${backup.size} bytes)`)
  return backup
})
