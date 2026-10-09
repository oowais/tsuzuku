import { useAdapters } from '../adapters'
import { useDb } from '../db'
import type { SourceStatus } from '../db/schema'
import { comingBack, ttlFor, type Sequel } from './coming-back'
import { createDismissedStore } from './dismissed-store'
import { createWriteLog } from './write-log'
import { useSourceWrapper, type createSourceWrapper } from './source-wrapper'

// How long your MAL list is used before it is read again. Our choice: it only decides which sequels still count.
const LIST_TTL_MS = 24 * 60 * 60 * 1000

export interface ComingBackResult {
  // Every sequel found; the ones you dismissed carry the flag, so the page can offer to undo it.
  sequels: (Sequel & { dismissed: boolean })[]
  // How each source answered, so the page can say a part is out of date instead of showing less silently.
  mal: { status: SourceStatus, stale: boolean, error?: string, retryAfter: number | null, fetchedAt: string | null }
  anilist: { status: SourceStatus, missing: number }
}

interface MalListItem {
  node?: { id?: unknown }
  list_status?: { status?: unknown }
}

// Reads your whole MAL list (from the cache when under a day old), looks the completed entries up on AniList by
// their sequel stage's freshness, and returns the sequels on no watching list. One failing source never blanks it:
// MAL's cached list or AniList's cached rows stand in, and the answer says so.
export interface ComingBackDeps {
  wrapper: ReturnType<typeof createSourceWrapper>
  mal: Pick<ReturnType<typeof useAdapters>['mal'], 'fetchAllStatuses'>
  anilist: Pick<ReturnType<typeof useAdapters>['anilist'], 'byMalIds'>
  dismissed: () => Set<number>
  // When you last wrote to MAL (a mark, a start) and it took: the cached list is out of date from then on.
  lastMalWrite: () => Date | null
}

export async function loadComingBack(now = Date.now(), deps?: ComingBackDeps): Promise<ComingBackResult> {
  const { wrapper, mal, anilist, dismissed, lastMalWrite } = deps ?? {
    wrapper: useSourceWrapper(),
    ...useAdapters(),
    dismissed: () => createDismissedStore(useDb()).all(),
    lastMalWrite: () => createWriteLog(useDb()).recent(200).find(w => w.source === 'mal' && w.result === 'ok')?.at ?? null
  }

  const cachedAt = wrapper.cachedAt('mal', 'all')
  let data = wrapper.readCache('mal', 'all') as { data: unknown[] } | undefined
  let result: ComingBackResult['mal'] = { status: 'ok', stale: false, retryAfter: null, fetchedAt: cachedAt?.toISOString() ?? null }
  const written = lastMalWrite()
  if (!data || !cachedAt || now - cachedAt.getTime() >= LIST_TTL_MS || (written && written > cachedAt)) {
    const res = await mal.fetchAllStatuses()
    data = res.data ?? undefined
    result = { status: res.status, stale: res.stale, error: res.error, retryAfter: res.retryAfter, fetchedAt: res.fetchedAt?.toISOString() ?? cachedAt?.toISOString() ?? null }
  }

  const statuses: Record<number, string> = {}
  for (const item of (data?.data ?? []) as MalListItem[]) {
    const id = item.node?.id
    const status = item.list_status?.status
    if (typeof id === 'number' && typeof status === 'string') statuses[id] = status
  }
  const completed = Object.keys(statuses).map(Number).filter(id => statuses[id] === 'completed')
  const looked = await anilist.byMalIds(completed, media => ttlFor(media, now))

  const gone = dismissed()
  return {
    sequels: comingBack({ statuses, media: looked.media, now }).map(s => ({ ...s, dismissed: gone.has(s.malId) })),
    mal: result,
    anilist: { status: looked.status, missing: looked.missing.length }
  }
}
