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
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import WebSocket from "ws";

const JOBS_PER_TICK = process.env.JOBS_PER_TICK ?? "3";
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

const [port, inspectorPort] = [await freePort(), await freePort()];
const wrangler = spawn(
  "npx",
  ["wrangler", "dev", "--test-scheduled", "--port", String(port), "--ip", "127.0.0.1", "--inspector-port", String(inspectorPort), "--persist-to", persist,
    "--var", `JOBS_PER_TICK:${JOBS_PER_TICK}`, "--var", "DEV_ROUTES:1", "--show-interactive-dev-session=false"],
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
  for (let i = 0; i < Math.ceil(60 / Number(JOBS_PER_TICK)) + 10; i++) {
    const r = await run("*/5 * * * *");
    if (r.result.claimed === 0) break;
    rows.push({ phase, ...r });
    // Deferred jobs (same host already used this tick) wait 5 minutes; make them due again.
    if (r.result.deferred) await fetch(`${base}/__dev/due?within=${10 * 60_000}`, { method: "POST" });
  }
}
rows.push({ phase: "daily again", ...(await run("7 6 * * *")) });
const keys = new Map((await (await fetch(`${base}/__dev/sources`)).json()).map((s) => [s.id, `${s.kind} ${s.key}`]));
ws.close();
wrangler.kill("SIGTERM");

console.log(`JOBS_PER_TICK=${JOBS_PER_TICK}`);
console.log("phase         claimed done resch defer retry  cpu ms  wall ms  sample µs");
for (const r of rows) {
  const t = r.result;
  const counts = r.phase.startsWith("daily") ? `sources=${t.synced.sources}`.padEnd(29) : [t.claimed, t.done, t.rescheduled, t.deferred, t.retried].map((n) => String(n).padStart(5)).join(" ");
  const which = !r.phase.startsWith("daily") && t.sources.length <= 2 ? "  " + t.sources.map((id) => keys.get(id)).join(", ") : "";
  console.log(`${r.phase.padEnd(13)} ${counts} ${r.cpu.toFixed(2).padStart(7)} ${r.wall.toFixed(0).padStart(8)} ${String(r.interval).padStart(10)}${which}`);
}
const ticks = rows.filter((r) => !r.phase.startsWith("daily"));
const max = Math.max(...ticks.map((r) => r.cpu));
console.log(`\nmax CPU per tick: ${max.toFixed(2)} ms${max > 10 ? "  ** over the 10 ms Free-plan limit **" : max > 7 ? "  (approaching 10 ms)" : ""}`);
process.exit(0);
