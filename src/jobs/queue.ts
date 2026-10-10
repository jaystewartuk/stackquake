import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Ctx } from "../context";
import { jobs, type Job, type JobKind } from "../db/schema";
import { DAY, HOUR, MINUTE } from "../util";

export const LOCK_MS = 60_000;
/** SPEC §7.2: retry after 1 m, 5 m, 30 m, 2 h, 12 h; the next failure parks the job. */
export const RETRY_BACKOFF = [MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 12 * HOUR];

export interface EnqueueInput {
  kind: JobKind;
  sourceId?: number | null;
  eventId?: number | null;
  payload?: Record<string, unknown> | null;
  runAfter?: number;
  /** Jobs with the same key are queued once. */
  dedupeKey?: string;
}

export async function enqueue(ctx: Ctx, job: EnqueueInput): Promise<void> {
  await ctx.db
    .insert(jobs)
    .values({
      kind: job.kind,
      sourceId: job.sourceId ?? null,
      eventId: job.eventId ?? null,
      payload: job.payload ?? null,
      runAfter: job.runAfter ?? ctx.clock.now(),
      dedupeKey: job.dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey });
}

export const pollJobKey = (sourceId: number) => `poll:${sourceId}`;

/**
 * Atomically locks up to `n` due jobs and returns them. One UPDATE … WHERE id IN (SELECT …)
 * RETURNING statement, so two ticks running at once can never claim the same job.
 */
export async function claimJobs(ctx: Ctx, n: number): Promise<Job[]> {
  const now = ctx.clock.now();
  const due = ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(lte(jobs.runAfter, now), isNull(jobs.parkedAt), or(isNull(jobs.lockedUntil), lt(jobs.lockedUntil, now))))
    .orderBy(asc(jobs.runAfter), asc(jobs.id))
    .limit(n);
  // attempts counts claims; success resets it, a deferral gives it back.
  return ctx.db
    .update(jobs)
    .set({ lockedUntil: now + LOCK_MS, attempts: sql`${jobs.attempts} + 1` })
    .where(inArray(jobs.id, due))
    .returning();
}

export async function completeJob(ctx: Ctx, job: Job): Promise<void> {
  await ctx.db.delete(jobs).where(eq(jobs.id, job.id));
}

/** Recurring jobs (polls) stay in the table and move to their next run. */
export async function rescheduleJob(ctx: Ctx, job: Job, runAfter: number): Promise<void> {
  await ctx.db.update(jobs).set({ runAfter, attempts: 0, lockedUntil: null, lastError: null }).where(eq(jobs.id, job.id));
}

/** Not run this tick (its host was already used). Not a failure. */
export async function deferJob(ctx: Ctx, job: Job, delayMs: number): Promise<void> {
  await ctx.db
    .update(jobs)
    .set({ runAfter: ctx.clock.now() + delayMs, lockedUntil: null, attempts: Math.max(0, job.attempts - 1) })
    .where(eq(jobs.id, job.id));
}

export async function parkJob(ctx: Ctx, job: Job, error: string): Promise<void> {
  await ctx.db.update(jobs).set({ lastError: error.slice(0, 2_000), lockedUntil: null, parkedAt: ctx.clock.now() }).where(eq(jobs.id, job.id));
}

/** `job.attempts` already includes this run (claimJobs counts it). */
export async function failJob(ctx: Ctx, job: Job, error: string): Promise<"retry" | "parked"> {
  const now = ctx.clock.now();
  const attempts = job.attempts;
  const lastError = error.slice(0, 2_000);
  if (attempts > RETRY_BACKOFF.length) {
    await parkJob(ctx, job, lastError);
    return "parked";
  }
  await ctx.db
    .update(jobs)
    .set({ attempts, lastError, lockedUntil: null, runAfter: now + RETRY_BACKOFF[attempts - 1] })
    .where(eq(jobs.id, job.id));
  return "retry";
}

/** Daily: make sure every active source has a poll job (repairs anything lost). */
export async function ensurePollJobs(ctx: Ctx): Promise<void> {
  await ctx.db.run(sql`
    INSERT INTO jobs (kind, source_id, run_after, attempts, dedupe_key)
    SELECT 'poll', id, next_poll_at, 0, 'poll:' || id FROM sources WHERE state = 'active'
    ON CONFLICT (dedupe_key) DO NOTHING`);
}

/** Daily: drop parked one-off jobs after 30 days. Parked polls stay so the admin sees them. */
export async function pruneJobs(ctx: Ctx): Promise<void> {
  await ctx.db.delete(jobs).where(and(lt(jobs.parkedAt, ctx.clock.now() - 30 * DAY), sql`${jobs.kind} <> 'poll'`));
}
