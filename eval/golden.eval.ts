// The golden set (SPEC §11) end to end against the live model: each case replays saved sources
// through the real watchers (baseline poll, then the changed poll) and the real pipeline steps,
// with only HTTP served from fixtures. Reports precision and recall per kind, the quote-found
// rate, cost, and the pass bar: no false positive among the "no event" cases, every deal change
// found with the right kind, every quote found verbatim.
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { syncCatalog } from "../src/catalog/catalog";
import { CATALOG } from "../src/catalog/entries";
import { configFromEnv, DEFAULT_MODELS, type Ctx } from "../src/context";
import { EVENT_KINDS, events, jobs, llmCalls, sources, type Event, type EventKind } from "../src/db/schema";
import { runTick } from "../src/jobs/runner";
import { AnthropicLlm } from "../src/llm/anthropic";
import type { Llm } from "../src/llm/llm";
import type { Note } from "../src/llm/schemas";
import { d1Db } from "../src/platform/cloudflare";
import { FakeClock, MemoryBlobStore, MemoryMailer } from "../src/platform/memory";
import { githubUrl } from "../src/sources/kinds/github";
import { npmUrl } from "../src/sources/kinds/npm";
import { normaliseUrl } from "../src/sources/normalise";
import { getSource, pollSource } from "../src/watch/poll";
import { addSource, FixtureHttp, resetDb } from "../test/helpers";

interface Case {
  id: string;
  spec: number;
  what: string;
  type: "feed" | "page" | "npm" | "github";
  catalog?: string;
  feed?: { url: string; file: string };
  item?: string;
  posts?: Record<string, { file: string; type: string }>;
  page?: { url: string; selector: string; type: string; before: string; after: string };
  package?: string;
  repo?: string;
  before?: object;
  after?: object;
  license?: object;
  expect: { kind: EventKind | null; status?: string; effective_date_prefix?: string; quote_contains?: string; note_mentions?: string[]; llm_calls?: number };
}

interface Result {
  id: string;
  expected: EventKind | null;
  actual: EventKind | null;
  status: string;
  event: Event | null;
  calls: { purpose: string; model: string; costUsd: number; outcome: string; inputTokens: number; outputTokens: number }[];
  cost: number;
  checks: string[];
  ms: number;
}

const golden = env.GOLDEN!;
const options = env.EVAL_OPTIONS!;
const file = (p: string) => golden.files[p];
const models = {
  classify: options.models.classify || DEFAULT_MODELS.classify,
  summarise: options.models.summarise || DEFAULT_MODELS.summarise,
  summariseHigh: options.models.summariseHigh || DEFAULT_MODELS.summariseHigh,
};

/** The feed without one item, for the baseline poll. */
function withoutItem(xml: string, link: string): string {
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/g;
  const out = xml.replace(re, (block) => (block.includes(link) ? "" : block));
  if (out === xml) throw new Error(`item ${link} not in feed`);
  return out;
}

async function drain(ctx: Ctx, clock: FakeClock) {
  for (let i = 0; i < 60; i++) {
    await runTick(ctx);
    const left = (await ctx.db.select().from(jobs).all()).filter((j) => j.parkedAt === null);
    if (left.length === 0) return;
    clock.advance(13 * 3_600_000);
  }
  throw new Error("pipeline did not settle");
}

async function runCase(c: Case, llm: Llm): Promise<Result> {
  await resetDb();
  const started = Date.now();
  const http = new FixtureHttp();
  const clock = new FakeClock();
  const ctx: Ctx = { db: d1Db(env.DB), blobs: new MemoryBlobStore(), clock, http: http.fetch, llm, mailer: new MemoryMailer(), config: { ...configFromEnv({}), jobsPerTick: 10, models } };
  await syncCatalog(ctx, CATALOG);
  await ctx.db.delete(jobs); // catalog polls; each case polls its own source below

  for (const [url, p] of Object.entries(c.posts ?? {})) http.set(url, new Response(file(p.file), { headers: { "content-type": p.type } }));

  let sourceId: number;
  let first: () => void;
  let second: () => void;
  if (c.type === "feed") {
    const f = c.feed!;
    const src = await ctx.db.select().from(sources).where(eq(sources.key, normaliseUrl(f.url))).get();
    if (!src) throw new Error(`${c.id}: feed ${f.url} is not in the catalog`);
    sourceId = src.id;
    const xml = file(f.file);
    first = () => http.set(src.url, new Response(withoutItem(xml, c.item!), { headers: { "content-type": "application/rss+xml" } }));
    second = () => http.set(src.url, new Response(xml, { headers: { "content-type": "application/rss+xml" } }));
  } else if (c.type === "page") {
    const p = c.page!;
    const src = await ctx.db.select().from(sources).where(eq(sources.key, `${normaliseUrl(p.url)} ${p.selector}`)).get();
    if (!src) throw new Error(`${c.id}: page ${p.url} is not in the catalog`);
    sourceId = src.id;
    first = () => http.set(src.url, new Response(file(p.before), { headers: { "content-type": p.type } }));
    second = () => http.set(src.url, new Response(file(p.after), { headers: { "content-type": p.type } }));
  } else if (c.type === "npm") {
    const src = await addSource(ctx, { kind: "npm", key: c.package!, url: npmUrl(c.package!) });
    sourceId = src.id;
    first = () => http.set(src.url, c.before!);
    second = () => http.set(src.url, c.after!);
  } else {
    const src = await addSource(ctx, { kind: "github_repo", key: c.repo!, url: githubUrl(c.repo!) });
    sourceId = src.id;
    http.set(`https://api.github.com/repos/${c.repo}/license`, c.license!);
    first = () => http.set(src.url, c.before!);
    second = () => http.set(src.url, c.after!);
  }

  first();
  const baseline = await pollSource(ctx, (await getSource(ctx, sourceId))!);
  if (baseline.status !== "baseline") throw new Error(`${c.id}: baseline poll gave ${baseline.status}: ${baseline.detail ?? ""}`);
  clock.advance(25 * 3_600_000);
  second();
  await pollSource(ctx, (await getSource(ctx, sourceId))!);
  await drain(ctx, clock);

  const all = await ctx.db.select().from(events).all();
  const live = all.filter((e) => e.status === "published" || e.status === "pending_review");
  const event = live[0] ?? all[0] ?? null;
  const calls = (await ctx.db.select().from(llmCalls).all()).map((r) => ({ purpose: r.purpose, model: r.model, costUsd: r.costUsd, outcome: r.outcome, inputTokens: r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens, outputTokens: r.outputTokens }));
  const actual = live[0]?.kind ?? null;

  const checks: string[] = [];
  const x = c.expect;
  if (live.length > 1) checks.push(`${live.length} live events, expected at most 1`);
  if (actual !== x.kind) checks.push(`kind: expected ${x.kind ?? "no event"}, got ${actual ?? "no event"}`);
  for (const e of live) if (!e.quoteFound) checks.push(`quote not found verbatim: ${JSON.stringify(e.quote)}`);
  if (live[0] && x.status && live[0].status !== x.status) checks.push(`status: expected ${x.status}, got ${live[0].status}`);
  if (live[0] && x.effective_date_prefix && !(live[0].effectiveDate ?? "").startsWith(x.effective_date_prefix)) checks.push(`effective date: expected ${x.effective_date_prefix}…, got ${live[0].effectiveDate}`);
  if (live[0] && x.quote_contains && !(live[0].quote ?? "").includes(x.quote_contains)) checks.push(`quote should contain "${x.quote_contains}"`);
  const note = live[0]?.note as Note | null | undefined;
  for (const m of x.note_mentions ?? []) if (note && !`${note.what_changed} ${note.title}`.includes(m)) checks.push(`note should mention ${m}`);
  if (x.llm_calls !== undefined && calls.length !== x.llm_calls) checks.push(`LLM calls: expected ${x.llm_calls}, got ${calls.length}`);
  return { id: c.id, expected: x.kind, actual, status: event?.status ?? "no event", event, calls, cost: calls.reduce((s, r) => s + r.costUsd, 0), checks, ms: Date.now() - started };
}

function metrics(results: Result[]) {
  const kinds = EVENT_KINDS.filter((k) => k !== "other" && results.some((r) => r.expected === k || r.actual === k));
  const rows = kinds.map((k) => {
    const tp = results.filter((r) => r.expected === k && r.actual === k).length;
    const fp = results.filter((r) => r.expected !== k && r.actual === k).length;
    const fn = results.filter((r) => r.expected === k && r.actual !== k).length;
    return { kind: k, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1 };
  });
  const withQuote = results.filter((r) => r.actual !== null);
  const quoteRate = withQuote.length ? withQuote.filter((r) => r.event?.quoteFound).length / withQuote.length : 1;
  return { rows, quoteRate };
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

it("golden set passes the SPEC §11 bar", async ({ task }) => {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (.dev.vars)");
  const llm = new AnthropicLlm(env.ANTHROPIC_API_KEY);
  const cases = (golden.cases as Case[]).filter((c) => !options.only || options.only.split(",").some((o) => c.id.startsWith(o)));
  const runs: Result[][] = [];
  for (let r = 0; r < Math.max(1, options.repeat); r++) {
    const results: Result[] = [];
    for (const c of cases) {
      try {
        results.push(await runCase(c, llm));
      } catch (e) {
        results.push({ id: c.id, expected: c.expect.kind, actual: null, status: "error", event: null, calls: [], cost: 0, checks: [`error: ${e instanceof Error ? e.message : String(e)}`], ms: 0 });
      }
    }
    runs.push(results);
  }

  const lines: string[] = [`models: classify=${models.classify} summarise=${models.summarise} summarise_high=${models.summariseHigh}`];
  runs.forEach((results, r) => {
    lines.push(`\nrun ${r + 1}`);
    lines.push(`${pad("case", 29)}${pad("expected", 11)}${pad("got", 11)}${pad("status", 15)}${pad("quote", 7)}${pad("calls", 34)}cost      s`);
    for (const x of results) {
      const calls = x.calls.map((c) => `${c.purpose[0]}:${c.model.replace("claude-", "")}${c.outcome === "ok" ? "" : `(${c.outcome})`}`).join(" ");
      lines.push(
        `${pad(x.id, 29)}${pad(x.expected ?? "-", 11)}${pad(x.actual ?? "-", 11)}${pad(x.status, 15)}${pad(x.actual ? (x.event?.quoteFound ? "yes" : "NO") : "", 7)}${pad(calls, 34)}$${x.cost.toFixed(4)}  ${(x.ms / 1000).toFixed(0)}${x.checks.length ? `\n    FAIL: ${x.checks.join("; ")}` : ""}`,
      );
    }
    const m = metrics(results);
    lines.push(`\n${pad("kind", 12)}precision  recall  (tp/fp/fn)`);
    for (const k of m.rows) lines.push(`${pad(k.kind, 12)}${k.precision.toFixed(2).padStart(9)}  ${k.recall.toFixed(2).padStart(6)}  (${k.tp}/${k.fp}/${k.fn})`);
    lines.push(`quote found verbatim: ${(m.quoteRate * 100).toFixed(0)}% of events`);
    lines.push(`cost: $${results.reduce((s, x) => s + x.cost, 0).toFixed(4)} over ${results.reduce((s, x) => s + x.calls.length, 0)} calls`);
    for (const purpose of ["classify", "summarise"]) {
      for (const model of new Set(results.flatMap((x) => x.calls.filter((c) => c.purpose === purpose).map((c) => c.model)))) {
        const cs = results.flatMap((x) => x.calls.filter((c) => c.purpose === purpose && c.model === model));
        const avg = (f: (c: (typeof cs)[number]) => number) => Math.round(cs.reduce((s, c) => s + f(c), 0) / cs.length);
        lines.push(`  ${purpose} on ${model}: ${cs.length} calls, avg ${avg((c) => c.inputTokens)} in / ${avg((c) => c.outputTokens)} out tokens, $${cs.reduce((s, c) => s + c.costUsd, 0).toFixed(4)}`);
      }
    }
    lines.push("\nnotes:");
    for (const x of results) {
      const n = x.event?.note as Note | null | undefined;
      if (!x.event) continue;
      lines.push(`- ${x.id} [${x.event.status}${x.event.reviewReason ? `: ${x.event.reviewReason}` : ""}]`);
      if (n) {
        lines.push(`  title: ${n.title}`);
        lines.push(`  what: ${n.what_changed}`);
        lines.push(`  quote: ${JSON.stringify(n.quote)}`);
        lines.push(`  effective: ${n.effective_date} · applies: ${JSON.stringify(n.applies_when)} · not affected: ${n.who_is_not_affected}`);
        lines.push(`  options: ${n.options.map((o) => `${o.catalog_id ?? o.name} (${o.effort})`).join(", ")} · uncertain: ${n.uncertain.join(" | ")} · confidence ${n.confidence}`);
      }
    }
  });
  const all = runs.flat();
  const failed = all.filter((x) => x.checks.length);
  lines.push(`\nTOTAL cost $${all.reduce((s, x) => s + x.cost, 0).toFixed(4)} · ${failed.length ? `FAILED ${failed.length} case run(s): ${failed.map((x) => x.id).join(", ")}` : "PASS"}`);
  (task.meta as { report?: string }).report = lines.join("\n");
  expect(failed.map((x) => `${x.id}: ${x.checks.join("; ")}`)).toEqual([]);
});
