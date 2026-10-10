#!/usr/bin/env node
// npm run poll -- <source-id | catalog-id | kind:key | --all> [--json] [--show]
//
// Polls once, locally, inside the real Workers runtime: starts `wrangler dev` with local D1 and
// R2 (state persists in .wrangler/state, so a second run compares against the first), calls the
// dev-only /__dev/poll route, prints the result and stops wrangler.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const args = process.argv.slice(2);
const json = args.includes("--json");
const show = args.includes("--show");
const target = args.includes("--all") ? "all" : args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: npm run poll -- <source-id|catalog-id|kind:key|--all> [--json]");
  process.exit(2);
}

const freePort = () =>
  new Promise((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } });
if (migrate.status !== 0) {
  process.stderr.write(migrate.stdout);
  process.stderr.write(migrate.stderr);
  process.exit(1);
}

const port = await freePort();
const wrangler = spawn("npx", ["wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1", "--var", "DEV_ROUTES:1", "--show-interactive-dev-session=false"], {
  stdio: ["ignore", "pipe", "pipe"],
  // Passes GITHUB_TOKEN through when it is set (raises the GitHub API limit from 60 to 5,000/h).
  env: { ...process.env, CLOUDFLARE_INCLUDE_PROCESS_ENV: process.env.GITHUB_TOKEN ? "true" : "false" },
});
let log = "";
wrangler.stdout.on("data", (d) => (log += d));
wrangler.stderr.on("data", (d) => (log += d));
const stop = () => wrangler.kill("SIGTERM");
process.on("exit", stop);

const base = `http://127.0.0.1:${port}`;
const started = Date.now();
for (;;) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {}
  if (wrangler.exitCode !== null || Date.now() - started > 60_000) {
    console.error("wrangler dev did not start:\n" + log);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 250));
}

const since = Date.now();
const res = await fetch(`${base}/__dev/poll?target=${encodeURIComponent(target)}&since=${since}${show ? "&show=1" : ""}`, { method: "POST" });
const body = await res.json();
stop();
if (!res.ok) {
  console.error(body.error ?? body);
  process.exit(1);
}
if (json) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
console.log(`${pad("id", 4)} ${pad("kind", 11)} ${pad("key", 58)} ${pad("status", 12)} ${pad("http", 4)} ${pad("ev", 2)} detail`);
for (const r of body.reports) {
  console.log(`${pad(r.sourceId, 4)} ${pad(r.kind, 11)} ${pad(r.key, 58)} ${pad(r.status, 12)} ${pad(r.httpStatus ?? "", 4)} ${pad(r.eventsCreated, 2)} ${r.detail ?? ""}`);
}
for (const [id, text] of Object.entries(body.shown ?? {})) {
  console.log(`\n----- source ${id}: ${text ? `${text.length} chars` : "no stored body"} -----\n${text ?? ""}\n`);
}
for (const d of body.diffs) console.log(`diff  source ${d.sourceId} ${d.url}: ${JSON.stringify(d.result)}`);
for (const e of body.events) console.log(`event #${e.id} [${e.kind}] source ${e.sourceId}: ${e.title}`);

const counts = {};
for (const r of body.reports) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log(`\n${body.reports.length} sources: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}; ${body.events.length} events created`);
console.log(`changes: ${counts.changed ?? 0}`);
