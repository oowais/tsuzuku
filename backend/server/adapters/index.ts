import { useDb } from "../db";
import { demoOAuth, isDemo, useDemoSources } from "../demo";
import { useOAuth } from "../lib/oauth";
import { useSourceWrapper } from "../lib/source-wrapper";
import { createAniListAdapter } from "./anilist";
import { createMalAdapter } from "./mal";
import { createSimklAdapter } from "./simkl";
import { createTraktAdapter } from "./trakt";
import { createTmdbAdapter } from "./tmdb";
import { createTraktPublic } from "./trakt-public";

let adapters: ReturnType<typeof createAdapters> | undefined;

function createAdapters() {
  // Demo mode: the same adapters, answered by the fake sources instead of the network.
  const demo = isDemo() ? { fetch: useDemoSources().fetch } : {};
  const opts = { wrapper: useSourceWrapper(), oauth: isDemo() ? demoOAuth : useOAuth(), ...demo };
  return {
    trakt: createTraktAdapter(opts),
    simkl: createSimklAdapter(opts),
    mal: createMalAdapter(opts),
    anilist: createAniListAdapter({ db: useDb(), wrapper: opts.wrapper, ...demo }),
    traktPublic: createTraktPublic({ db: useDb(), wrapper: opts.wrapper, ...demo }),
    // Demo mode answers TMDB from the fixtures, so it needs no key.
    tmdb: createTmdbAdapter({
      wrapper: opts.wrapper,
      ...demo,
      ...(isDemo() ? { env: { TMDB_API_KEY: "demo" } as NodeJS.ProcessEnv } : {}),
    }),
  };
}

export function useAdapters() {
  adapters ??= createAdapters();
  return adapters;
}
