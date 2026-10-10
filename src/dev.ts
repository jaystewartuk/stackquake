// Local-only routes used by `npm run poll` (scripts/poll.mjs drives them under `wrangler dev`).
import { and, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import { Hono } from "hono";
import { syncCatalog } from "./catalog/catalog";
import { CATALOG } from "./catalog/entries";
import { catalogSources, events, jobs, sources, type Source } from "./db/schema";
import { makeCtx, type AppEnv } from "./env";
import { completeJob, enqueue } from "./jobs/queue";
import { extractDiff } from "./watch/extract-diff";
import { recordEvent } from "./watch/events";
import { loadSnapshot, pollSafely, snapshotKey, type PollReport } from "./watch/poll";
import { gzip, sha256Hex, utf8 } from "./util";

export const devRoutes = new Hono<{ Bindings: AppEnv }>();

devRoutes.use("*", async (c, next) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_ROUTES !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(host)) return c.notFound();
  await next();
});

/** Resolves "all", a numeric source id, a catalog id, or "kind:key". */
async function resolveTargets(ctx: ReturnType<typeof makeCtx>, target: string): Promise<Source[]> {
  if (target === "all") return ctx.db.select().from(sources).where(eq(sources.state, "active")).all();
  if (/^\d+$/.test(target)) return ctx.db.select().from(sources).where(eq(sources.id, Number(target))).all();
  const linked = await ctx.db.select({ id: catalogSources.sourceId }).from(catalogSources).where(eq(catalogSources.catalogId, target)).all();
  if (linked.length) return ctx.db.select().from(sources).where(inArray(sources.id, linked.map((l) => l.id))).all();
  const i = target.indexOf(":");
  if (i > 0) {
    const kind = target.slice(0, i) as Source["kind"];
    return ctx.db.select().from(sources).where(and(eq(sources.kind, kind), eq(sources.key, target.slice(i + 1)))).all();
  }
  return [];
}

devRoutes.post("/poll", async (c) => {
  const ctx = makeCtx(c.env);
  await syncCatalog(ctx, CATALOG);
  const target = c.req.query("target") ?? "";
  const targets = await resolveTargets(ctx, target);
  if (!targets.length) return c.json({ error: `no source matches "${target}"` }, 404);

  // Different hosts in parallel, one request at a time per host.
  const byHost = new Map<string, Source[]>();
  for (const s of targets) {
    const host = new URL(s.url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), s]);
  }
  const reports: PollReport[] = [];
  await Promise.all(
    [...byHost.values()].map(async (list) => {
      for (const s of list) reports.push(await pollSafely(ctx, s));
    }),
  );

  // Run the page diff steps queued by this poll right away, so the CLI shows their events.
  const ids = targets.map((t) => t.id);
  const diffs = await ctx.db.select().from(jobs).where(and(eq(jobs.kind, "extract_diff"), inArray(jobs.sourceId, ids), isNull(jobs.parkedAt))).all();
  const diffResults = [];
  for (const job of diffs) {
    const source = targets.find((t) => t.id === job.sourceId)!;
    const p = job.payload as { oldSha: string; newSha: string };
    diffResults.push({ sourceId: source.id, url: source.url, result: await extractDiff(ctx, source, p.oldSha, p.newSha) });
    await completeJob(ctx, job);
  }

  const since = Number(c.req.query("since") ?? "0");
  const newEvents = await ctx.db
    .select({ id: events.id, sourceId: events.sourceId, kind: events.kind, title: events.title, detectedAt: events.detectedAt })
    .from(events)
    .where(inArray(events.sourceId, ids))
    .all();
  // --show: the stored canonical text of each source, to check selectors and normalisation.
  const shown: Record<number, string | null> = {};
  if (c.req.query("show") === "1") {
    for (const r of reports) shown[r.sourceId] = r.sha256 ? await loadSnapshot(ctx, r.sha256) : null;
  }
  return c.json({
    shown,
    reports: reports.sort((a, b) => a.sourceId - b.sourceId),
    diffs: diffResults,
    events: newEvents.filter((e) => e.detectedAt >= since),
  });
});

/**
 * Seeds one event of each pipeline path (used by scripts/measure-cpu.mjs): a feed item whose post
 * is at `postUrl`, a page diff between two texts, and an npm licence change.
 */
devRoutes.post("/seed-pipeline", async (c) => {
  const ctx = makeCtx(c.env);
  const { postUrl, before, after } = await c.req.json<{ postUrl: string; before: string; after: string }>();
  const byKind = async (kind: Source["kind"]) => (await ctx.db.select().from(sources).where(eq(sources.kind, kind)).limit(1).get())!;
  const feed = await byKind("feed");
  const page = await byKind("page");
  const npm = await byKind("npm");
  await recordEvent(ctx, { sourceId: feed.id, sourceKind: "feed", catalogId: "deno", change: { kind: "other", title: "Deno is joining Cloudflare", dedupeTitle: `feed item ${postUrl} ${Date.now()}`, quoteUrl: postUrl, afterText: "Today we are announcing that the Deno team is joining Cloudflare." } });
  const [oldSha, newSha] = await Promise.all([sha256Hex(before), sha256Hex(after)]);
  for (const [sha, text] of [[oldSha, before], [newSha, after]]) await ctx.blobs.put(snapshotKey(sha), await gzip(utf8(text)));
  await enqueue(ctx, { kind: "extract_diff", sourceId: page.id, payload: { oldSha, newSha }, dedupeKey: `diff:${page.id}:${oldSha}:${newSha}` });
  await recordEvent(ctx, { sourceId: npm.id, sourceKind: "npm", catalogId: null, change: { kind: "license", title: `${npm.key} (npm): licence changed from MIT to BUSL-1.1`, dedupeTitle: `licence MIT -> BUSL-1.1 ${Date.now()}`, quoteUrl: npm.url, beforeText: '"license": "MIT"', afterText: '"license": "BUSL-1.1" (version 9.0.0)' } });
  return c.json({ ok: true });
});

/**
 * Makes queued polls (or, with ?pipeline=1, pipeline steps) due now (used by
 * scripts/measure-cpu.mjs). With ?within=ms, only jobs due within that window (deferred ones) are
 * moved.
 */
devRoutes.post("/due", async (c) => {
  const ctx = makeCtx(c.env);
  const now = ctx.clock.now();
  const within = Number(c.req.query("within") ?? "Infinity");
  // ?pipeline=1: the event pipeline's jobs instead of polls.
  const kind = c.req.query("pipeline") === "1" ? ne(jobs.kind, "poll") : eq(jobs.kind, "poll");
  const cond = Number.isFinite(within) ? and(kind, lte(jobs.runAfter, now + within)) : kind;
  await ctx.db.update(jobs).set({ runAfter: now, lockedUntil: null }).where(cond);
  return c.json({ ok: true });
});

devRoutes.get("/sources", async (c) => {
  const ctx = makeCtx(c.env);
  return c.json(await ctx.db.select().from(sources).all());
});
