import { databasePath, useDb } from '../db'
import { isDemo } from '../demo'
import { backupDir, createBackups } from './backup'

export function useBackups() {
  return createBackups(useDb(), backupDir(databasePath(), process.env, isDemo()), { keep: Number(process.env.BACKUP_KEEP || 14) })
}
