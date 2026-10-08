import { useDb } from '../db'
import { useOAuth } from '../lib/oauth'
import { useSourceWrapper } from '../lib/source-wrapper'
import { createAniListAdapter } from './anilist'
import { createMalAdapter } from './mal'
import { createSimklAdapter } from './simkl'
import { createTraktAdapter } from './trakt'

let adapters: ReturnType<typeof createAdapters> | undefined

function createAdapters() {
  const opts = { wrapper: useSourceWrapper(), oauth: useOAuth() }
  return {
    trakt: createTraktAdapter(opts),
    simkl: createSimklAdapter(opts),
    mal: createMalAdapter(opts),
    anilist: createAniListAdapter({ db: useDb(), wrapper: opts.wrapper })
  }
}

export function useAdapters() {
  adapters ??= createAdapters()
  return adapters
}
