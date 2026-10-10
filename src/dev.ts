// Local-only routes used by `npm run poll` (scripts/poll.mjs drives them under `wrangler dev`).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { syncCatalog } from "./catalog/catalog";
import { CATALOG } from "./catalog/entries";
import { catalogSources, events, jobs, sources, type Source } from "./db/schema";
import { makeCtx, type AppEnv } from "./env";
import { completeJob } from "./jobs/queue";
import { KINDS } from "./sources/kinds";
import { extractDiff } from "./watch/extract-diff";
import { pollSafely, type PollReport } from "./watch/poll";

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
    const host = KINDS[s.kind].hosts(s)[0];
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
  return c.json({
    reports: reports.sort((a, b) => a.sourceId - b.sourceId),
    diffs: diffResults,
    events: newEvents.filter((e) => e.detectedAt >= since),
  });
});

devRoutes.get("/sources", async (c) => {
  const ctx = makeCtx(c.env);
  return c.json(await ctx.db.select().from(sources).all());
});
