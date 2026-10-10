// Coming back's answer (#66), shared: the Coming back section shows it, and Up Next cards for a Trakt show
// nothing links use it to offer the matching sequel instead of a search. Fetched once per page, on demand.
export type SequelStage = 'announced' | 'scheduled' | 'airing' | 'released'
export interface ComingBackSequel {
  malId: number
  anilistId: number
  title: string
  format: string
  stage: SequelStage
  startDate: { year: number | null, month: number | null, day: number | null }
  nextEpisode: { episode: number, airingAt: number } | null
  from: { malId: number, title: string }
  onPlanToWatch: boolean
  cover: string | null
  dismissed: boolean
}
export interface ComingBackResult {
  sequels: ComingBackSequel[]
  mal: { status: string, stale: boolean, error?: string, retryAfter: number | null, fetchedAt: string | null }
  anilist: { status: string, missing: number, error?: string }
}

export function useComingBack() {
  const data = useState<ComingBackResult | null>('coming-back', () => null)
  const loading = useState('coming-back-loading', () => false)
  const error = useState<string | null>('coming-back-error', () => null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      data.value = await $fetch<ComingBackResult>('/api/coming-back')
    } catch (e) {
      error.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    } finally {
      loading.value = false
    }
  }

  // Loads unless it is loaded or loading.
  function ensure() {
    if (!data.value && !loading.value) load()
  }

  return { data, loading, error, load, ensure }
}

// Sequels that belong to a Trakt show by title: the season it follows, or the sequel itself, named like the
// show (case, punctuation and "Season N" ignored). Only candidates: starting one still goes through the preview.
const norm = (t: string) => t.toLowerCase().replace(/\bseason\s*\d+\b|\b\d+(st|nd|rd|th)\s+season\b/g, '').replace(/[^\p{L}\p{N}]+/gu, '')
export function sequelsForShow(title: string, sequels: ComingBackSequel[]): ComingBackSequel[] {
  const want = norm(title)
  if (!want) return []
  return sequels.filter(s => !s.dismissed && (norm(s.from.title) === want || norm(s.title) === want))
}
