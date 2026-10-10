import { loadComingBack } from '../lib/coming-back-service'

// The sequels of anime you completed that are on no watching list (#66). Read when the section is opened, never
// with the Up Next page: it reads your MAL list and AniList, each cached (MAL for a day, AniList by sequel stage).
export default defineEventHandler(() => loadComingBack())
