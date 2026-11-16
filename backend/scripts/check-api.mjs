// Checks the running server against the API contract (api/openapi.yaml, #108): calls every endpoint the way the
// UI does and validates each answer against the spec, for its status code. Meant for the demo server
// (`vp run dev:demo`); it never calls a real source itself, but its writes go to whatever the server is connected
// to, so `--writes` (mark, add, start, link, accept, dismiss, back up) refuses a server not in demo mode.
//
//   node scripts/check-api.mjs [base URL, default http://localhost:3000] [--writes] [--save <dir>]
//     [--now <ISO date>] [--record <dir> --source-log <file>]
//
// `--save` writes each answer to <dir>/<operationId>.json. `--now` is the date the calls are built from
// (calendar range, "today"), for a server on a fixed clock. `--record` writes each call as a golden fixture
// case (api/fixtures/README.md): <dir>/<NNN>-<operationId>/ with the request, the answer, and the source
// responses the server's demo sources wrote to `--source-log` during the call (DEMO_RECORD). Used by
// scripts/record-fixtures.mjs. Exits 1 on any mismatch or on an operation that was never called.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const writes = flag("--writes");
const saveDir = option("--save");
const recordDir = option("--record");
const sourceLog = option("--source-log");
if (recordDir && !sourceLog) throw new Error("--record needs --source-log");
const now = option("--now") ? new Date(option("--now")) : new Date();
let caseNumber = 0;
// Dates stamped by the real wall clock, not the server's (fixed) JS clock: SQLite's `unixepoch()` column
// defaults and backup file times. Recorded as "<wall-clock>", so fixtures are the same on every run.
const recordStart = Date.now() - 60_000;
const wallClock = (value) =>
  JSON.parse(JSON.stringify(value), (_, v) => {
    if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v)) return v;
    const t = Date.parse(v);
    return t >= recordStart && t <= Date.now() + 60_000 ? "<wall-clock>" : v;
  });
const sourceLines = () =>
  existsSync(sourceLog) ? readFileSync(sourceLog, "utf8").split("\n").filter(Boolean) : [];

const specPath = new URL("../../api/openapi.yaml", import.meta.url);
const spec = YAML.parse(readFileSync(specPath, "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, "spec");

// Every operation in the spec, by method and path template.
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, op]) => ({
    method: method.toUpperCase(),
    path,
    op,
    re: new RegExp(`^${path.replace(/\{\w+\}/g, "[^/]+")}$`),
  })),
);
const called = new Set();
const failures = [];

const pointer = (...parts) =>
  "spec#/" + parts.map((p) => String(p).replaceAll("~", "~0").replaceAll("/", "~1")).join("/");

function schemaRef(o, status, type) {
  const responses = o.op.responses;
  const key = responses[status] ? String(status) : "default";
  let response = responses[key];
  if (!response) return null;
  let at = ["paths", o.path, o.method.toLowerCase(), "responses", key];
  if (response.$ref) {
    at = response.$ref.replace(/^#\//, "").split("/");
    response = at.reduce((n, p) => n[p], spec);
  }
  if (!response.content?.[type]) return null;
  return pointer(...at, "content", type, "schema");
}

// One call, validated. `expect` is the status it should answer with (200 unless said).
async function call(method, url, { body, expect = 200 } = {}) {
  const pathname = url.split("?")[0];
  const o = operations.find((x) => x.method === method && x.re.test(pathname));
  const label = `${method} ${url}`;
  if (!o) {
    failures.push(`${label}: not in the spec`);
    return null;
  }
  called.add(o.op.operationId);
  const init = { method, redirect: "manual" };
  if (body) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const before = recordDir ? sourceLines().length : 0;
  const res = await fetch(base + url, init);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const text = await res.text();
  if (recordDir) {
    const dir = join(
      recordDir,
      `${String(++caseNumber).padStart(3, "0")}-${o.op.operationId}${res.status === 200 ? "" : `-${res.status}`}`,
    );
    mkdirSync(dir, { recursive: true });
    const write = (name, value) =>
      writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");
    write("request.json", { method, url, body: body ?? null });
    write("response.json", {
      status: res.status,
      contentType: type || null,
      ...(res.headers.get("location") ? { location: res.headers.get("location") } : {}),
      // Other bodies (a backup file) differ on every run; only the type and status are compared.
      body: type === "application/json" ? wallClock(JSON.parse(text)) : null,
    });
    write(
      "sources.json",
      sourceLines()
        .slice(before)
        .map((l) => JSON.parse(l)),
    );
  }
  if (res.status !== expect) {
    failures.push(`${label}: status ${res.status}, expected ${expect}: ${text.slice(0, 300)}`);
    return null;
  }
  if (!o.op.responses[res.status] && !o.op.responses.default)
    failures.push(`${label}: status ${res.status} not in the spec`);
  if (type !== "application/json") {
    console.log(`ok   ${label} (${res.status}, ${type || "no body"})`);
    return null;
  }
  const data = JSON.parse(text);
  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    const suffix = res.status === 200 ? "" : `.${res.status}`;
    writeFileSync(
      join(saveDir, `${o.op.operationId}${suffix}.json`),
      JSON.stringify(data, null, 2) + "\n",
    );
  }
  const ref = schemaRef(o, res.status, type);
  if (!ref) {
    failures.push(`${label}: no ${type} schema for status ${res.status}`);
    return data;
  }
  const validate = ajv.getSchema(ref);
  if (validate(data)) console.log(`ok   ${label}`);
  else {
    failures.push(
      `${label}:\n` +
        validate.errors
          .slice(0, 15)
          .map((e) => `    ${e.instancePath || "/"} ${e.message} ${JSON.stringify(e.params)}`)
          .join("\n"),
    );
    console.log(`FAIL ${label}`);
  }
  return data;
}

const get = (url, opts) => call("GET", url, opts);
const post = (url, body, opts) => call("POST", url, { ...opts, body });
const q = (params) => new URLSearchParams(params).toString();
const day = (d) => d.toISOString();

// The version the app is built against must be the one the server serves.
const health = await get("/api/health");
if (health && String(health.apiVersion) !== String(spec.info.version))
  failures.push(`apiVersion: server ${health.apiVersion}, spec ${spec.info.version}`);

await get("/api/sources/status");
await get("/api/sources/watching");
const upNext = await get("/api/up-next");
const movies = await get("/api/movies");
const from = new Date(now);
from.setUTCHours(0, 0, 0, 0);
await get(
  `/api/calendar?${q({ from: day(from), to: day(new Date(from.getTime() + 31 * 864e5)) })}`,
);
await get("/api/stats");
await get("/api/stats?refresh=1");
const comingBack = await get("/api/coming-back");
await get("/api/write-log");
const mappings = await get("/api/mappings");
await get("/api/mapping/preview");
await get("/api/backups");

// A wrong query is refused with the error shape.
await get("/api/trakt/seasons?show=x", { expect: 400 });

const rows = upNext?.rows ?? [];
const traktRow = rows.find((r) => r.cells?.trakt?.entry?.ids?.trakt);
const traktId = traktRow?.cells.trakt.entry.ids.trakt;
const title = traktRow?.title ?? "a";
await get(`/api/trakt/search?${q({ q: title })}`);
if (traktId) await get(`/api/trakt/seasons?${q({ show: traktId })}`);
const anime = await get(
  `/api/anilist/search?${q({ q: rows.find((r) => r.kind === "anime")?.title ?? title })}`,
);
// A broad query, so the results include a movie on no list (the add preview then has steps).
const tmdbResults = await get(`/api/movies/search?${q({ from: "tmdb", q: "the" })}`);
await get(`/api/movies/search?${q({ from: "anilist", q: anime?.[0]?.title ?? "a" })}`);
await get(
  `/api/movies/link-search?${q({ target: "trakt", q: movies?.rows?.[0]?.title ?? "the" })}`,
);
await get(`/api/movies/link-search?${q({ target: "mal", q: anime?.[0]?.title ?? "a" })}`);
const movieRow = movies?.rows?.[0];
if (movieRow) await get(`/api/movies/link-titles?${q({ rowKey: movieRow.key })}`);

// Previews write nothing.
const markable = rows.find((r) => r.hasNext && r.agrees) ?? rows.find((r) => r.hasNext);
const markPlan = markable
  ? await post("/api/mark/preview", {
      rowKey: markable.key,
      signature: markable.signature,
      // A row the sources disagree on is marked on one source the user picks.
      source: markable.agrees
        ? undefined
        : Object.keys(markable.cells).find((k) => markable.cells[k]?.entry?.next),
    })
  : null;
await post("/api/mark/preview", { rowKey: "no-such-row" }, { expect: 404 });
const movieMarkable = movies?.rows?.find((r) =>
  Object.values(r.cells).some((c) => c?.entry && !c.entry.watched),
);
const movieMarkPlan = movieMarkable
  ? await post("/api/movies/mark/preview", { rowKey: movieMarkable.key }, { expect: 200 })
  : null;
const tmdbPick = tmdbResults?.find((m) => m.listedOn.length === 0) ?? tmdbResults?.[0];
const movieAddPlan = tmdbPick
  ? await post("/api/movies/add/preview", { from: "tmdb", id: tmdbPick.id })
  : null;
if (movieRow) await post("/api/movies/add/preview", { rowKey: movieRow.key });
const startRow = rows.find((r) => r.start?.sources?.length);
const startPlan = startRow
  ? await post("/api/next-season/preview", { rowKey: startRow.key })
  : null;
const sequel = comingBack?.sequels?.[0];
const animeAddId = sequel?.malId ?? anime?.[0]?.malId;
const animeAddPlan = animeAddId
  ? await post("/api/anime/add/preview", { malId: animeAddId, status: "plan_to_watch" })
  : null;

// Demo mode refuses to connect a source.
await get("/api/auth/trakt/start", { expect: 400 });

if (writes) {
  const demo = await fetch(`${base}/api/auth/trakt/start`, { redirect: "manual" });
  if (demo.status !== 400) throw new Error("--writes needs a server in demo mode");

  const backup = await post("/api/backups");
  if (backup?.name) await get(`/api/backups/${encodeURIComponent(backup.name)}`);

  const differing = rows.find((r) => r.differs);
  if (differing) {
    await post("/api/up-next/accept", { rowKey: differing.key, signature: differing.signature });
    await post("/api/up-next/undo-accept", { rowKey: differing.key });
  }
  if (sequel) {
    await post("/api/coming-back/dismiss", { malId: sequel.malId });
    await post("/api/coming-back/undo-dismiss", { malId: sequel.malId });
  }

  const steps = (plan) =>
    plan?.steps?.map((s) => ({ source: s.source, expected: s.expected })) ?? [];
  if (markPlan?.steps?.length)
    await post("/api/mark/confirm", {
      rowKey: markPlan.rowKey,
      steps: steps(markPlan),
      today: day(now).slice(0, 10),
    });
  if (movieMarkPlan?.steps?.length)
    await post("/api/movies/mark/confirm", {
      rowKey: movieMarkPlan.rowKey,
      steps: steps(movieMarkPlan),
      rating: 8,
      today: day(now).slice(0, 10),
    });
  if (movieAddPlan?.steps?.length)
    await post("/api/movies/add/confirm", {
      from: "tmdb",
      id: tmdbPick.id,
      steps: movieAddPlan.steps.map((s) => ({ source: s.source })),
    });
  if (startPlan?.steps?.length && startPlan.target)
    await post("/api/next-season/confirm", {
      rowKey: startPlan.rowKey,
      malId: startPlan.target.malId,
      steps: steps(startPlan),
    });
  if (animeAddPlan?.steps?.length)
    await post("/api/anime/add/confirm", {
      malId: animeAddId,
      status: "plan_to_watch",
      steps: steps(animeAddPlan),
    });

  // Mappings: confirm a proposal, move it, unlink it; reject another.
  const [proposal, other] = mappings?.proposals ?? [];
  if (proposal) {
    const place = proposal.placement ?? { traktSeason: 1, episodeOffset: 0 };
    await post("/api/mappings/confirm", {
      traktId: proposal.trakt.trakt,
      animeKey: proposal.animeKey,
      traktSeason: place.traktSeason,
      episodeOffset: place.episodeOffset,
    });
    const after = await get("/api/mappings");
    const season = after?.mappings?.flatMap((m) => m.seasons ?? []).find((s) => s.malId && s.id);
    if (season) {
      await post("/api/mappings/edit", {
        seasonId: season.id,
        traktSeason: season.traktSeason,
        episodeOffset: season.episodeOffset,
      });
      await post("/api/mappings/unlink", { seasonId: season.id });
    }
  }
  // With a single proposal, reject that pair once it is unlinked.
  const rejected = other ?? proposal;
  if (rejected)
    await post("/api/mappings/reject", {
      traktId: rejected.trakt.trakt,
      animeKey: rejected.animeKey,
    });
  const showLink = mappings?.mappings?.find((m) => m.kind === "show" && m.status === "linked");
  if (showLink) {
    await post("/api/mappings/unlink", { mappingId: showLink.id });
    await post("/api/mappings/unlink", { mappingId: showLink.id, restore: true });
  }

  // A movie link made by hand, then undone.
  const link = (await get("/api/movies"))?.rows?.flatMap((r) => r.links ?? []).find((l) => l.id);
  if (link) await call("DELETE", `/api/movies/links/${link.id}`);
  await call("DELETE", "/api/movies/links/999999", { expect: 404 });
}

// Never reached from here: the OAuth callback needs a provider round trip.
const skip = new Set(["getAuthSourceCallback"]);
const missing = operations
  .filter((o) => writes || (o.method === "GET" && o.path !== "/api/backups/{name}"))
  .map((o) => o.op.operationId)
  .filter((id) => !called.has(id) && !skip.has(id));
for (const id of missing) failures.push(`${id}: never called`);

if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n` + failures.join("\n"));
  process.exit(1);
}
console.log(`\nAll ${called.size} operations match the spec.`);
