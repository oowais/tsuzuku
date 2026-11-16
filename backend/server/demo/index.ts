import { appendFileSync } from "node:fs";
import type { AccessTokenResult } from "../lib/oauth";
import { createDemoSources } from "./fake-sources";

export { DEMO_DATABASE_PATH, assertDemoAllowed, isDemo } from "./mode";

type Host = "trakt" | "simkl" | "mal" | "anilist";

let sources: ReturnType<typeof createDemoSources> | undefined;

// The one fake source server for this process. DEMO_FAIL=mal,simkl makes those answer with rate limits.
export function useDemoSources() {
  const fail = (process.env.DEMO_FAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Host => ["trakt", "simkl", "mal", "anilist"].includes(s));
  if (!sources) {
    sources = createDemoSources({ fail });
    const file = process.env.DEMO_RECORD;
    if (file) sources = { ...sources, fetch: recording(sources.fetch, file) };
  }
  return sources;
}

// Response headers the adapters read (paging, rate limits). Request headers are never recorded.
const RECORDED_HEADERS = /^(x-pagination-|retry-after$|content-type$)/i;

const bodyText = (body: RequestInit["body"]) =>
  body == null
    ? null
    : typeof body === "string" || body instanceof URLSearchParams
      ? body.toString()
      : "<not text>";

// The fixture recorder (scripts/record-fixtures.mjs): every fake source answer, one JSON line each, in the
// order they were answered. These become the source responses in api/fixtures/.
function recording(inner: typeof fetch, file: string): typeof fetch {
  return async (input, init) => {
    const res = await inner(input, init);
    const text = await res.clone().text();
    const type = res.headers.get("content-type") ?? "";
    appendFileSync(
      file,
      JSON.stringify({
        request: {
          method: init?.method ?? "GET",
          url: input instanceof Request ? input.url : String(input),
          body: bodyText(init?.body),
        },
        response: {
          status: res.status,
          headers: Object.fromEntries(
            [...res.headers].filter(([name]) => RECORDED_HEADERS.test(name)),
          ),
          body: type.includes("json") && text ? JSON.parse(text) : text || null,
        },
      }) + "\n",
    );
    return res;
  };
}

// Every source counts as connected; the token is a placeholder the fake sources accept and nothing stores.
export const demoOAuth = {
  getAccessToken: async (): Promise<AccessTokenResult> => ({ ok: true, token: "demo" }),
};

// Client IDs the adapters require, so demo mode runs without a filled-in .env. They never leave the machine.
export function applyDemoEnv(env = process.env) {
  for (const key of [
    "TRAKT_CLIENT_ID",
    "SIMKL_CLIENT_ID",
    "SIMKL_CLIENT_SECRET",
    "MAL_CLIENT_ID",
    "MAL_CLIENT_SECRET",
  ])
    env[key] = "demo";
}
