import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { useBackups } from '../../lib/backup-service'

// Downloads one backup. Only a name in the current list is served; anything else is a 404.
export default defineEventHandler((event) => {
  const path = useBackups().file(decodeURIComponent(getRouterParam(event, 'name') ?? ''))
  if (!path) throw createError({ statusCode: 404, statusMessage: 'No such backup' })
  setResponseHeaders(event, {
    'Content-Type': 'application/vnd.sqlite3',
    'Content-Disposition': `attachment; filename="${basename(path)}"`,
    'Cache-Control': 'no-store'
  })
  return sendStream(event, createReadStream(path))
})
