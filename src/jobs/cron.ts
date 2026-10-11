import { inArray, sql } from "drizzle-orm";
import { checkBudget } from "../alerts/budget";
import { enqueueDigests } from "../alerts/digest";
import { enqueueDeliveries } from "../alerts/fanout";
import { syncCatalog, type CatalogEntry } from "../catalog/catalog";
import type { Ctx } from "../context";
import { snapshots } from "../db/schema";
import { disableOrphanUserSources } from "../stack/deps";
import { DAY } from "../util";
import { ensurePipelineJobs, ensurePollJobs, pruneJobs } from "./queue";
import { runTick, type TickReport } from "./runner";

export const KEEP_BODIES = 20;
const SNAPSHOT_ROW_TTL = 30 * DAY;

/**
 * Keeps the latest 20 bodies per source (SPEC §5). Bodies are content-addressed and can be shared
 * between sources, so a blob is deleted only when no kept row still points at it.
 */
export async function pruneSnapshots(ctx: Ctx): Promise<{ blobsDeleted: number; rowsDeleted: number }> {
  const stale = await ctx.db.all<{ r2_key: string }>(sql`
    WITH ranked AS (
      SELECT id, r2_key, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY fetched_at DESC, id DESC) AS rn
      FROM snapshots WHERE r2_key IS NOT NULL
    )
    SELECT DISTINCT r2_key FROM ranked
    WHERE rn > ${KEEP_BODIES}
      AND r2_key NOT IN (SELECT r2_key FROM ranked WHERE rn <= ${KEEP_BODIES})
      AND r2_key NOT IN (SELECT 'snap/' || last_sha FROM sources WHERE last_sha IS NOT NULL)
      AND r2_key NOT IN (SELECT r2_key FROM snapshots WHERE r2_key IS NOT NULL AND fetched_at > ${ctx.clock.now() - DAY})`);
  const keys = stale.map((r) => r.r2_key);
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    await ctx.blobs.delete(chunk);
    await ctx.db.update(snapshots).set({ r2Key: null }).where(inArray(snapshots.r2Key, chunk));
  }
  // Metadata rows without a body are only history; keep a month of it.
  const cutoff = ctx.clock.now() - SNAPSHOT_ROW_TTL;
  const deleted = await ctx.db.all<{ id: number }>(sql`DELETE FROM snapshots WHERE r2_key IS NULL AND fetched_at < ${cutoff} RETURNING id`);
  return { blobsDeleted: keys.length, rowsDeleted: deleted.length };
}

/**
 * Short-lived security records (privacy notice, "How long we keep it"): expired sessions, sign-in
 * and email-change links a day after they expire, and rate-limit counters two days after their
 * window (the longest window is a day).
 */
export async function prunePersonal(ctx: Ctx): Promise<void> {
  const now = ctx.clock.now();
  await ctx.db.run(sql`DELETE FROM sessions WHERE expires_at < ${now}`);
  await ctx.db.run(sql`DELETE FROM magic_links WHERE expires_at < ${now - DAY}`);
  await ctx.db.run(sql`DELETE FROM rate_limits WHERE window_start < ${now - 2 * DAY}`);
}

/**
 * The daily cron: sync the catalog, schedule overdue polls, stalled pipeline steps and lost
 * deliveries, queue today's digests, check the LLM budget, prune.
 */
export async function runDaily(ctx: Ctx, entries: CatalogEntry[]) {
  const synced = await syncCatalog(ctx, entries);
  await disableOrphanUserSources(ctx);
  await ensurePollJobs(ctx);
  await ensurePipelineJobs(ctx);
  await enqueueDeliveries(ctx);
  await enqueueDigests(ctx);
  const budget = await checkBudget(ctx);
  const pruned = await pruneSnapshots(ctx);
  await pruneJobs(ctx);
  await prunePersonal(ctx);
  return { synced, pruned, budget };
}

export async function runCron(ctx: Ctx, task: "tick" | "daily", entries: CatalogEntry[]): Promise<TickReport | Awaited<ReturnType<typeof runDaily>>> {
  return task === "tick" ? runTick(ctx) : runDaily(ctx, entries);
}
