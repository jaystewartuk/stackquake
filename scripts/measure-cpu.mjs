#!/usr/bin/env node
// Measures CPU time per cron tick (SPEC §11 E5) under `wrangler dev --test-scheduled`.
//
// Starts wrangler dev on a fresh local state, attaches to the DevTools inspector and records a
// V8 CPU profile (50 µs sampling) around each /__scheduled call. CPU time is the sampled time
// spent outside "(idle)"; time waiting on fetches, D1 and R2 is idle. Runs the daily cron
// (catalog sync), then ticks until the first polls are done (baseline path: hash, gzip, R2 put),
// then makes every poll due again and ticks through the steady-state path.
//
// Local timing differs from production; treat the numbers as an estimate.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import WebSocket from "ws";

const JOBS_PER_TICK = process.env.JOBS_PER_TICK ?? "3";
const ALERT_JOBS_PER_TICK = process.env.ALERT_JOBS_PER_TICK ?? "2";
const persist = ".wrangler/measure";
rmSync(persist, { recursive: true, force: true });

const freePort = () =>
  new Promise((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", persist], { stdio: "pipe", env: { ...process.env, CI: "1" } });
if (migrate.status !== 0) throw new Error(String(migrate.stderr));

// Local stand-ins for the Claude API and a blog post, so the pipeline steps run their real code
// (SDK request and response handling, HTML extraction) without network or cost.
const golden = "testdata/golden";
const postHtml = readFileSync(`${golden}/posts/deno-cloudflare.html`);
const DENO_QUOTE = "After that year we will end our development of the Deno runtime.";
const note = (over) => ({ material: true, kind: "eol", title: "Deno runtime development ends", what_changed: "One more year of fixes, then development ends.", quote: DENO_QUOTE, effective_date: "2027-10", applies_when: { hosting: [], use: [], tier: [] }, who_is_not_affected: null, options: [{ catalog_id: "nodejs", name: "Node.js", why: "Mature", effort: "medium" }], uncertain: [], confidence: 0.95, ...over });
function cannedAnswer(body) {
  const input = body.messages[0].content.map((b) => b.text).join("\n");
  if (JSON.stringify(body.output_config.format.schema).includes("one_line")) return { kind: "eol", confidence: 0.95, effective_date: "2027-10", one_line: "Development ends.", quote: DENO_QUOTE };
  if (input.includes("Source type: page change")) return note({ kind: "free_tier", title: "Workers Free plan: daily requests cut to 50,000", quote: "| **Free** | 50,000 per day | No charge for duration | 10 milliseconds of CPU time per invocation |", effective_date: null });
  if (input.includes("Source type: registry")) return note({ kind: "license", title: "Licence moves to BUSL-1.1", quote: '"license": "BUSL-1.1"', effective_date: null });
  return note();
}
// A stand-in GitHub (API under /gh, raw files under /raw) serving two repos for the import
// measurements: the test monorepo, and the same plus a package.json with 160 dependencies
// (more than the 150 a project watches).
const mono = JSON.parse(readFileSync("testdata/repos/monorepo.json", "utf8"));
const big = { ...mono, "package.json": JSON.stringify({ name: "big", dependencies: Object.fromEntries(Array.from({ length: 160 }, (_, i) => [`stackquake-measure-pkg-${i}`, "^1.0.0"])) }) };
const ghRoutes = new Map();
for (const [repo, files] of [["acme/shop", mono], ["acme/big", big]]) {
  ghRoutes.set(`/gh/repos/${repo}`, { default_branch: "main", private: false });
  const dirs = new Map([["", new Map()]]);
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    parts.forEach((name, i) => {
      const parent = parts.slice(0, i).join("/");
      if (!dirs.has(parent)) dirs.set(parent, new Map());
      dirs.get(parent).set(name, i === parts.length - 1 ? { type: "blob", size: content.length } : { type: "tree" });
    });
    ghRoutes.set(`/raw/${repo}/main/${path}`, content);
  }
  const sha = (d) => `t${d.replace(/[^\w]/g, "_")}`;
  for (const [dir, entries] of dirs) {
    const tree = [...entries].map(([name, e]) => ({ path: name, type: e.type, sha: e.type === "tree" ? sha(dir ? `${dir}/${name}` : name) : "b", size: e.size }));
    ghRoutes.set(`/gh/repos/${repo}/git/trees/${dir === "" ? "main" : sha(dir)}`, { tree });
  }
}

const stub = createHttpServer((req, res) => {
  let data = "";
  req.on("data", (d) => (data += d));
  req.on("end", () => {
    const gh = ghRoutes.get(decodeURIComponent(req.url));
    if (gh !== undefined) return res.writeHead(200, { "content-type": typeof gh === "string" ? "text/plain" : "application/json" }).end(typeof gh === "string" ? gh : JSON.stringify(gh));
    if (req.method === "POST" && req.url === "/ses/v2/email/outbound-emails") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ MessageId: "stub" }));
    if (req.url === "/post") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(postHtml);
    if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
      const body = JSON.parse(data);
      const text = JSON.stringify(cannedAnswer(body));
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        id: "msg_stub", type: "message", role: "assistant", model: body.model,
        content: [{ type: "thinking", thinking: "", signature: "stub" }, { type: "text", text }],
        stop_reason: "end_turn", stop_sequence: null, stop_details: null,
        usage: { input_tokens: 5000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }));
    }
    res.writeHead(404).end();
  });
});
const stubPort = await freePort();
await new Promise((r) => stub.listen(stubPort, "127.0.0.1", r));
process.on("exit", () => stub.close());

const [port, inspectorPort] = [await freePort(), await freePort()];
const wrangler = spawn(
  "npx",
  ["wrangler", "dev", "--test-scheduled", "--port", String(port), "--ip", "127.0.0.1", "--local-upstream", `127.0.0.1:${port}`, "--inspector-port", String(inspectorPort), "--persist-to", persist,
    "--var", `JOBS_PER_TICK:${JOBS_PER_TICK}`, "--var", "DEV_ROUTES:1", "--var", `ANTHROPIC_BASE_URL:http://127.0.0.1:${stubPort}`, "--var", "ANTHROPIC_API_KEY:stub",
    "--var", `ALERT_JOBS_PER_TICK:${ALERT_JOBS_PER_TICK}`, "--var", `AWS_SES_API_BASE:http://127.0.0.1:${stubPort}/ses`, "--var", "AWS_SES_ACCESS_KEY_ID:AKIASTUB", "--var", "AWS_SES_SECRET_ACCESS_KEY:stub", "--var", "LINK_SECRET:measure-link-secret-0123456789",
    "--var", `GITHUB_API_BASE:http://127.0.0.1:${stubPort}/gh`, "--var", `GITHUB_RAW_BASE:http://127.0.0.1:${stubPort}/raw`,
    "--show-interactive-dev-session=false"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
process.on("exit", () => wrangler.kill("SIGTERM"));
let out = "";
const waiters = [];
const onData = (d) => {
  out += d;
  for (const w of [...waiters]) if (w.test(out)) waiters.splice(waiters.indexOf(w), 1);
};
wrangler.stdout.on("data", onData);
wrangler.stderr.on("data", onData);
const waitFor = (pred, ms = 120_000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout\n" + out.slice(-3000))), ms);
    const w = { test: (s) => { const m = pred(s); if (m) { clearTimeout(t); resolve(m); } return !!m; } };
    if (!w.test(out)) waiters.push(w);
  });

const base = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
  if (i > 240) throw new Error("wrangler did not start\n" + out);
  await new Promise((r) => setTimeout(r, 250));
}

// DevTools protocol through wrangler's inspector proxy (workerd allows one inspector client,
// and the proxy holds it). Node's built-in WebSocket fails the proxy handshake; ws works.
const ws = new WebSocket(`ws://127.0.0.1:${inspectorPort}/ws`);
await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
let nextId = 1;
const pending = new Map();
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error(`no reply to ${method}`)), 30_000);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    ws.send(JSON.stringify({ id, method, params }));
  });
const debug = (...a) => process.env.DEBUG && console.error(...a);
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 50 });

function topFrames(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const deltas = profile.timeDeltas.filter((d) => d > 0).sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] ?? 50;
  const t = {};
  profile.samples.forEach((s, i) => {
    const f = byId.get(s)?.callFrame;
    const k = `${f?.functionName || "(anon)"} ${f?.url?.split("/").pop() ?? ""}:${f?.lineNumber}`;
    t[k] = (t[k] ?? 0) + Math.min(profile.timeDeltas[i] ?? 0, 3 * median) / 1000;
  });
  return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 15);
}

/**
 * workerd does not tell the profiler when the isolate is idle, so a wait on fetch/D1/R2 shows up
 * as one long gap before the next sample. CPU time is estimated by counting each non-idle sample
 * for at most 3x the median sampling interval: gaps longer than that are waiting, not work.
 */
function cpuMs(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const deltas = profile.timeDeltas.filter((d) => d > 0).sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] ?? 50;
  let busy = 0;
  profile.samples.forEach((s, i) => {
    if (byId.get(s)?.callFrame.functionName === "(idle)") return;
    busy += Math.min(profile.timeDeltas[i] ?? 0, 3 * median);
  });
  return { cpu: busy / 1000, wall: (profile.endTime - profile.startTime) / 1000, interval: median };
}

async function run(cron) {
  const before = out.length;
  debug("start", cron);
  await send("Profiler.start");
  debug("started");
  await fetch(`${base}/__scheduled?cron=${encodeURIComponent(cron)}`);
  const line = await waitFor((s) => {
    const m = s.slice(before).match(/\{"cron":"[^"]+","task":"(tick|daily)","result":(\{.*?\})\}\s*$/m);
    return m ? JSON.parse(m[2]) : null;
  });
  debug("logged", line);
  const { profile } = (await send("Profiler.stop")).result;
  if (process.env.DEBUG === "2") console.error(topFrames(profile));
  return { result: line, ...cpuMs(profile) };
}

const rows = [];
const daily = await run("7 6 * * *");
rows.push({ phase: "daily", ...daily });
for (const phase of ["first polls", "steady state"]) {
  if (phase === "steady state") await fetch(`${base}/__dev/due`, { method: "POST" });
  // Enough ticks for every source (each tick runs at most one page or feed poll).
  for (let i = 0; i < daily.result.synced.sources + 10; i++) {
    const r = await run("*/5 * * * *");
    if (r.result.claimed === 0) break;
    rows.push({ phase, ...r });
    // Deferred jobs (same host already used this tick) wait 5 minutes; make them due again.
    if (r.result.deferred) await fetch(`${base}/__dev/due?within=${10 * 60_000}`, { method: "POST" });
  }
}
// Pipeline: one feed item (post fetch, classify, summarise), one page diff (diff, summarise) and
// one npm licence change (summarise), against the local stubs.
await fetch(`${base}/__dev/seed-pipeline`, {
  method: "POST",
  body: JSON.stringify({ postUrl: `http://127.0.0.1:${stubPort}/post`, before: readFileSync(`${golden}/pages/cloudflare-workers-pricing.md`, "utf8"), after: readFileSync(`${golden}/pages/cloudflare-workers-pricing.free-tier-edit.md`, "utf8") }),
});
await fetch(`${base}/__dev/due?pipeline=1`, { method: "POST" });
for (let i = 0; i < 40; i++) {
  const r = await run("*/5 * * * *");
  if (r.result.claimed === 0) break;
  rows.push({ phase: "pipeline", ...r });
  await fetch(`${base}/__dev/due?pipeline=1&within=${24 * 3_600_000}`, { method: "POST" });
}
// Alerts: 450 users with Redis; a licence change for the self-hosted ones (fan-out in 3 chunks,
// then 9 deliveries through an Amazon SES stub: SigV4 signing and the mail_sends check) and a pricing change for everyone (held for the
// digest). The daily run then queues the digests of the 5 users whose digest day is today.
await fetch(`${base}/__dev/seed-alerts`, { method: "POST", body: JSON.stringify({ users: 450, affectedEvery: 50, digestUsers: 5 }) });
await fetch(`${base}/__dev/due?pipeline=1`, { method: "POST" });
for (let i = 0; i < 40; i++) {
  const r = await run("*/5 * * * *");
  if (r.result.claimed === 0) break;
  rows.push({ phase: "alerts", ...r });
  await fetch(`${base}/__dev/due?pipeline=1&within=${24 * 3_600_000}`, { method: "POST" });
}
rows.push({ phase: "daily again", ...(await run("7 6 * * *")) });
await fetch(`${base}/__dev/due?pipeline=1`, { method: "POST" });
for (let i = 0; i < 20; i++) {
  const r = await run("*/5 * * * *");
  if (r.result.claimed === 0) break;
  rows.push({ phase: "digest", ...r });
}

// Web: one HTTP request per measurement, profiled the same way as a tick. The session user is on
// Team, since it imports two projects (Free allows one).
async function profileFetch(path, init = {}) {
  await send("Profiler.start");
  const res = await fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { cookie: `sq_session=${session.token}`, ...(init.headers ?? {}) } });
  const body = await res.text();
  const { profile } = (await send("Profiler.stop")).result;
  return { status: res.status, location: res.headers.get("location"), body, ...cpuMs(profile) };
}
const session = await (await fetch(`${base}/__dev/session`, { method: "POST", body: JSON.stringify({ email: "measure@example.com", plan: "team" }) })).json();
const webRows = [];
const form = (fields) => ({ method: "POST", body: new URLSearchParams({ _csrf: session.csrf, ...fields }), headers: { "content-type": "application/x-www-form-urlencoded", origin: base } });
let lastProject;
for (const repo of ["acme/shop", "acme/big"]) {
  const created = await profileFetch("/app/projects", form({ name: repo, repo, next: "import" }));
  lastProject = /\/app\/projects\/(\d+)/.exec(created.location)[1];
  webRows.push({ what: `POST /app/projects (${repo})`, ...created });
  for (let i = 0; i < 12; i++) {
    const r = await profileFetch(created.location);
    const step = /<li class="current">[\s\S]*?<span>([^<]*)</.exec(r.body)?.[1] ?? (r.status === 302 ? "done" : r.body.includes("Import failed") ? "failed" : "");
    webRows.push({ what: `import ${repo} load ${i + 1}: ${step}`, ...r });
    if (r.status !== 200 || r.body.includes("Import failed")) break;
  }
}
const projectPage = await profileFetch(`/app/projects/${lastProject}`);
const depId = /\/app\/deps\/(\d+)/.exec(projectPage.body)?.[1];
for (const path of ["/app", `/app/projects/${lastProject}`, `/app/projects/${lastProject}/services`, `/app/projects/${lastProject}/profiles`, `/app/deps/${depId}`, "/", "/catalog", "/catalog/supabase", "/events", "/events.rss"]) {
  for (const pass of [1, 2]) webRows.push({ what: `GET ${path}${pass === 2 ? " (again)" : ""}`, ...(await profileFetch(path)) });
}
const keys = new Map((await (await fetch(`${base}/__dev/sources`)).json()).map((s) => [s.id, `${s.kind} ${s.key}`]));
ws.close();
wrangler.kill("SIGTERM");

console.log(`JOBS_PER_TICK=${JOBS_PER_TICK} ALERT_JOBS_PER_TICK=${ALERT_JOBS_PER_TICK}`);
console.log("phase         claimed done resch defer retry  cpu ms  wall ms  sample µs");
for (const r of rows) {
  const t = r.result;
  const counts = r.phase.startsWith("daily") ? `sources=${t.synced.sources}`.padEnd(29) : [t.claimed, t.done, t.rescheduled, t.deferred, t.retried].map((n) => String(n).padStart(5)).join(" ");
  const which = r.phase.startsWith("daily") ? "" : "  " + t.kinds.map((k, i) => (k === "poll" ? (keys.get(t.sources[i]) ?? "").slice(0, 70) : k)).join(" | ");
  console.log(`${r.phase.padEnd(13)} ${counts} ${r.cpu.toFixed(2).padStart(7)} ${r.wall.toFixed(0).padStart(8)} ${String(r.interval).padStart(10)}${which}`);
}
const ticks = rows.filter((r) => !r.phase.startsWith("daily"));
const pipe = rows.filter((r) => r.phase === "pipeline");
if (pipe.length) console.log(`max CPU per pipeline tick: ${Math.max(...pipe.map((r) => r.cpu)).toFixed(2)} ms`);
for (const phase of ["alerts", "digest"]) {
  const list = rows.filter((r) => r.phase === phase);
  if (list.length) console.log(`max CPU per ${phase} tick: ${Math.max(...list.map((r) => r.cpu)).toFixed(2)} ms`);
}
console.log("\nweb request                                              status  cpu ms  wall ms  bytes");
for (const r of webRows) console.log(`${r.what.slice(0, 56).padEnd(56)} ${String(r.status).padStart(6)} ${r.cpu.toFixed(2).padStart(7)} ${r.wall.toFixed(0).padStart(8)} ${String(r.body.length).padStart(6)}`);
console.log(`max CPU per web request: ${Math.max(...webRows.map((r) => r.cpu)).toFixed(2)} ms`);
const max = Math.max(...ticks.map((r) => r.cpu));
console.log(`\nmax CPU per tick: ${max.toFixed(2)} ms${max > 10 ? "  ** over the 10 ms Free-plan limit **" : max > 7 ? "  (approaching 10 ms)" : ""}`);
process.exit(0);
