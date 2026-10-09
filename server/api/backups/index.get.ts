import { useBackups } from '../../lib/backup-service'

// The backups in the backups folder, newest first.
export default defineEventHandler(() => useBackups().list())
