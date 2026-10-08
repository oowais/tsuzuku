import { useDb } from '../db'
import { createWriteLog } from '../lib/write-log'

// The write log, newest first.
export default defineEventHandler(() => createWriteLog(useDb()).recent())
