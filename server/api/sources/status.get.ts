import { useDb } from '../../db'
import { isDemo } from '../../demo'
import { getSourceStatuses } from '../../lib/source-wrapper'

// Feeds the per-source status chips. Reads stored state only; it never calls a source.
// In demo mode every source counts as connected, without a stored token.
export default defineEventHandler(() => getSourceStatuses(useDb()).map(s => (isDemo() ? { ...s, connected: true } : s)))
