import { useDb } from '../db'

// Open the database and run migrations at startup, so a bad migration fails fast.
export default defineNitroPlugin(() => {
  useDb()
})
