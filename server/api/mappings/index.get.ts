import { mappingOverview } from '../../lib/mapping-service'

// Mapping page data: your list entries, stored links, and proposals waiting for your confirm.
// Stores ID-proven links as a side effect (local database only).
export default defineEventHandler(() => mappingOverview())
