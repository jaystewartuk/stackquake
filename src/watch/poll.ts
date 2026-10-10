// The poll step (SPEC §7.2): fetch → normalise → hash → snapshot → compare → events.
// Safe to retry: blobs are content-addressed, events and follow-up jobs have dedupe keys, and
// the source row (which marks the poll as done) is written last.
import { eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { catalogSources, snapshots, sources, type Source } from "../db/schema";
import { enqueue } from "../jobs/queue";
import { KINDS } from "../sources/kinds";
import type { CatalogLink, DetectedChange } from "../sources/types";
import { DAY, errorMessage, fromUtf8, gunzip, gzip, MINUTE, sha256Hex, utf8 } from "../util";
import { recordEvent } from "./events";

export const BLOCK_STRIKES = 3;
const BACKOFF_BASE = 5 * MINUTE;
const BACKOFF_MAX = DAY;

export type PollStatus = "baseline" | "unchanged" | "changed" | "not_modified" | "blocked" | "retry" | "too_large" | "skipped";

export interface PollReport {
  sourceId: number;
  kind: string;
  key: string;
  status: PollStatus;
  httpStatus: number | null;
  sha256: string | null;
  eventsCreated: number;
  detail?: string;
  nextPollAt: number;
}

export const snapshotKey = (sha: string) => `snap/${sha}`;

export function backoffMs(failures: number, retryAfterMs: number | null = null): number {
  const exp = Math.min(BACKOFF_MAX, BACKOFF_BASE * 2 ** Math.max(0, failures - 1));
  return Math.min(BACKOFF_MAX, Math.max(exp, retryAfterMs ?? 0));
}

export async function loadSnapshot(ctx: Ctx, sha: string): Promise<string | null> {
  const body = await ctx.blobs.get(snapshotKey(sha));
  return body ? fromUtf8(await gunzip(body)) : null;
}

export async function catalogLinks(ctx: Ctx, sourceId: number): Promise<CatalogLink[]> {
  const rows = await ctx.db.select().from(catalogSources).where(eq(catalogSources.sourceId, sourceId)).all();
  return rows.map((r) => ({ catalogId: r.catalogId, filter: r.filter ?? null }));
}

/** The event scope: the catalog entry if exactly one uses this source. */
export const scopeOf = (links: CatalogLink[]) => (links.length === 1 ? links[0].catalogId : null);

async function record(ctx: Ctx, source: Source, links: CatalogLink[], changes: DetectedChange[]): Promise<number> {
  let created = 0;
  for (const change of changes) if ((await recordEvent(ctx, { sourceId: source.id, sourceKind: source.kind, catalogId: scopeOf(links), change })).created) created++;
  return created;
}

export async function pollSource(ctx: Ctx, source: Source): Promise<PollReport> {
  const handler = KINDS[source.kind];
  const now = ctx.clock.now();
  const base = { sourceId: source.id, kind: source.kind, key: source.key };
  if (source.state !== "active") {
    return { ...base, status: "skipped", httpStatus: null, sha256: source.lastSha, eventsCreated: 0, detail: `source is ${source.state}`, nextPollAt: source.nextPollAt };
  }

  const links = await catalogLinks(ctx, source.id);
  const prev = source.lastSha ? source.lastState : null;
  const input = { source, prev, links, prevCanonical: () => (source.lastSha ? loadSnapshot(ctx, source.lastSha) : Promise.resolve(null)) };
  let r: Awaited<ReturnType<typeof handler.poll>>;
  try {
    r = await handler.poll(ctx, input);
  } catch (e) {
    // A bad response (HTML instead of JSON, a parser bug) is the source's problem: back off and
    // show it on the source. Throwing would eventually park the recurring poll job.
    r = { type: "retry", status: 0, reason: `error: ${errorMessage(e)}`, retryAfterMs: null };
  }

  if (r.type === "ok") {
    const sha = await sha256Hex(r.canonical);
    const changed = sha !== source.lastSha;
    let r2Key: string | null = null;
    if (changed) {
      r2Key = snapshotKey(sha);
      if (!(await ctx.blobs.has(r2Key))) await ctx.blobs.put(r2Key, await gzip(utf8(r.canonical)));
    }
    await ctx.db.insert(snapshots).values({ sourceId: source.id, fetchedAt: now, httpStatus: r.status, sha256: sha, size: r.canonical.length, r2Key });
    const eventsCreated = await record(ctx, source, links, r.changes);
    if (source.kind === "page" && changed && source.lastSha) {
      await enqueue(ctx, { kind: "extract_diff", sourceId: source.id, payload: { oldSha: source.lastSha, newSha: sha }, dedupeKey: `diff:${source.id}:${source.lastSha}:${sha}` });
    }
    const nextPollAt = now + handler.intervalMs;
    await ctx.db
      .update(sources)
      .set({ etag: r.etag, lastModified: r.lastModified, lastSha: sha, lastState: r.state, nextPollAt, failCount: 0, blockStrikes: 0, lastOkAt: now, lastError: null })
      .where(eq(sources.id, source.id));
    const status: PollStatus = !source.lastSha ? "baseline" : changed ? "changed" : "unchanged";
    return { ...base, status, httpStatus: r.status, sha256: sha, eventsCreated, nextPollAt };
  }

  if (r.type === "not_modified") {
    await ctx.db.insert(snapshots).values({ sourceId: source.id, fetchedAt: now, httpStatus: 304, sha256: source.lastSha });
    const eventsCreated = await record(ctx, source, links, handler.onUnchanged?.(ctx, input) ?? []);
    const nextPollAt = now + handler.intervalMs;
    await ctx.db.update(sources).set({ nextPollAt, failCount: 0, blockStrikes: 0, lastOkAt: now, lastError: null }).where(eq(sources.id, source.id));
    return { ...base, status: "not_modified", httpStatus: 304, sha256: source.lastSha, eventsCreated, nextPollAt };
  }

  await ctx.db.insert(snapshots).values({ sourceId: source.id, fetchedAt: now, httpStatus: r.status });
  if (r.type === "blocked") {
    // robots.txt is a definite answer; 403s and challenges get three strikes.
    const strikes = r.status === 0 ? BLOCK_STRIKES : source.blockStrikes + 1;
    const blocked = strikes >= BLOCK_STRIKES;
    const nextPollAt = blocked ? source.nextPollAt : now + backoffMs(strikes);
    await ctx.db
      .update(sources)
      .set({ blockStrikes: strikes, state: blocked ? "blocked" : "active", lastError: r.reason, nextPollAt })
      .where(eq(sources.id, source.id));
    return { ...base, status: "blocked", httpStatus: r.status, sha256: null, eventsCreated: 0, detail: `${r.reason} (strike ${strikes}/${BLOCK_STRIKES}${blocked ? ", now blocked" : ""})`, nextPollAt };
  }

  const failures = source.failCount + 1;
  const nextPollAt = now + backoffMs(failures, r.type === "retry" ? r.retryAfterMs : null);
  await ctx.db.update(sources).set({ failCount: failures, lastError: r.reason, nextPollAt }).where(eq(sources.id, source.id));
  return { ...base, status: r.type, httpStatus: r.status, sha256: null, eventsCreated: 0, detail: r.reason, nextPollAt };
}

/** Poll wrapper used by the CLI: never throws, reports the error instead. */
export async function pollSafely(ctx: Ctx, source: Source): Promise<PollReport> {
  try {
    return await pollSource(ctx, source);
  } catch (e) {
    return { sourceId: source.id, kind: source.kind, key: source.key, status: "retry", httpStatus: null, sha256: null, eventsCreated: 0, detail: `error: ${errorMessage(e)}`, nextPollAt: source.nextPollAt };
  }
}

export async function getSource(ctx: Ctx, id: number): Promise<Source | undefined> {
  return ctx.db.select().from(sources).where(eq(sources.id, id)).get();
}
