import { useDb } from '../../db'
import { getSourceStatuses } from '../../lib/source-wrapper'

// Feeds the per-source status chips. Reads stored state only; it never calls a source.
export default defineEventHandler(() => getSourceStatuses(useDb()))
