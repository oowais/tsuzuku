// Records the golden fixtures in api/fixtures/ (see api/fixtures/README.md, #108 step 2.2). For each scenario,
// starts its own demo server (fake sources, nothing reaches a real one) on a fixed virtual clock
// (scripts/fixed-clock.mjs), with a fresh database and backup folder, dumps the seeded database, then runs
// scripts/check-api.mjs --record against it. Every case gets the request, the legacy answer and the fake
// source responses behind it.
//
//   node scripts/record-fixtures.mjs [--port 3100] [--out <fixtures dir>] [--only <scenario>]
//
// Never touches .data/demo.db or a dev server already running on port 3000.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const FIXED_NOW = "2026-10-09T12:00:00.000Z";

// demo: every source answers, writes included. demo-blocked: Simkl and MAL answer 429 on every call, so the
// reads show stale cached data and "blocked" (writes are left out: they refuse a blocked source).
const SCENARIOS = {
  demo: { fail: [], writes: true },
  "demo-blocked": { fail: ["simkl", "mal"], writes: false },
};

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(option("--port", "3100"));
const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(option("--out", join(here, "../../api/fixtures")));
const only = option("--only", null);
const base = `http://localhost:${port}`;

if (
  await fetch(`${base}/api/health`).then(
    () => true,
    () => false,
  )
)
  throw new Error(`Something already answers on port ${port}; pick another with --port`);

for (const [name, scenario] of Object.entries(SCENARIOS))
  if (!only || only === name) await record(name, scenario);

async function record(name, scenario) {
  const out = join(root, name);
  const tmp = mkdtempSync(join(tmpdir(), "tsuzuku-fixtures-"));
  const sourceLog = join(tmp, "sources.jsonl");
  const casesDir = join(out, "cases");
  rmSync(casesDir, { recursive: true, force: true });

  const server = spawn("vp", ["exec", "nuxt", "dev", "--port", String(port)], {
    cwd: join(here, ".."),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      TSUZUKU_DEMO: "1",
      TSUZUKU_DEMO_DB: join(tmp, "demo.db"),
      BACKUP_DIR: join(tmp, "backups"),
      DEMO_RECORD: sourceLog,
      DEMO_FAIL: scenario.fail.join(","),
      FIXED_NOW,
      TZ: "UTC",
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS ?? ""} --import ${join(here, "fixed-clock.mjs")}`.trim(),
      TOKEN_ENC_KEY: randomBytes(32).toString("base64"),
    },
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const stop = () => {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {}
    rmSync(tmp, { recursive: true, force: true });
  };

  try {
    let up = false;
    for (let i = 0; i < 180 && !up; i++) {
      up = await fetch(`${base}/api/health`).then(
        (r) => r.ok,
        () => false,
      );
      if (!up) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!up) throw new Error(`The demo server did not start:\n${log}`);
    // The database as the demo seed left it, before the first case: the state every case starts from.
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, "seed.json"),
      JSON.stringify(dump(join(tmp, "demo.db")), null, 2) + "\n",
    );

    const check = spawn(
      process.execPath,
      [
        join(here, "check-api.mjs"),
        base,
        ...(scenario.writes ? ["--writes"] : []),
        "--now",
        FIXED_NOW,
        "--record",
        casesDir,
        "--source-log",
        sourceLog,
      ],
      { stdio: "inherit" },
    );
    const code = await new Promise((r) => check.on("exit", r));
    if (code !== 0) throw new Error(`check-api failed (exit ${code})`);
    writeFileSync(
      join(out, "scenario.json"),
      JSON.stringify({ now: FIXED_NOW, timeZone: "UTC", demoFail: scenario.fail }, null, 2) + "\n",
    );
    console.log(`\nRecorded to ${out}`);
  } finally {
    stop();
  }
}

// Every table's rows, in id order. Times SQLite stamped with the real wall clock (`unixepoch()` defaults) are
// "<wall-clock>", as in the answers (scripts/check-api.mjs).
function dump(file) {
  const db = new Database(file, { readonly: true });
  const since = Date.now() - 10 * 60_000;
  const tables = db
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
    )
    .all()
    .map((t) => t.name);
  const out = {};
  for (const table of tables)
    out[table] = db
      .prepare(`select * from "${table}" order by rowid`)
      .all()
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            k.endsWith("_at") && typeof v === "number" && v >= since ? "<wall-clock>" : v,
          ]),
        ),
      );
  db.close();
  return out;
}
