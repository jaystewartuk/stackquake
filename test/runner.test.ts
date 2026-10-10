import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobs, type Job, type JobKind } from "../src/db/schema";
import { claimJobs, enqueue, LOCK_MS, RETRY_BACKOFF } from "../src/jobs/queue";
import { HostGate, runTick, type StepHandler } from "../src/jobs/runner";
import { MINUTE } from "../src/util";
import { resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

const steps = (handler: StepHandler): Record<JobKind, StepHandler> => ({ poll: handler, extract_diff: handler, fetch_post: handler, classify: handler, summarise: handler, import: handler, fanout: handler, deliver: handler, digest: handler });
const getJob = async (ctx: ReturnType<typeof testCtx>["ctx"], id: number) => (await ctx.db.select().from(jobs).where(eq(jobs.id, id)).get())!;

describe("job runner", () => {
  it("retries a throwing step with backoff 1m, 5m, 30m, 2h, 12h, then parks it", async () => {
    const { ctx, clock } = testCtx();
    await enqueue(ctx, { kind: "extract_diff", dedupeKey: "x" });
    const [{ id }] = await ctx.db.select().from(jobs).all();
    let calls = 0;
    const failing = steps(async () => {
      calls++;
      throw new Error("boom");
    });

    for (const delay of RETRY_BACKOFF) {
      const report = await runTick(ctx, failing);
      expect(report).toMatchObject({ claimed: 1, retried: 1 });
      const job = await getJob(ctx, id);
      expect(job.runAfter).toBe(clock.now() + delay);
      expect(job.lockedUntil).toBeNull();
      expect(job.lastError).toContain("boom");
      // Not due yet: nothing is claimed a moment before the backoff ends.
      clock.advance(delay - 1);
      expect((await runTick(ctx, failing)).claimed).toBe(0);
      clock.advance(1);
    }
    const report = await runTick(ctx, failing);
    expect(report).toMatchObject({ claimed: 1, parked: 1 });
    const parked = await getJob(ctx, id);
    expect(parked.parkedAt).toBe(clock.now());
    expect(parked.attempts).toBe(6);
    clock.advance(30 * 24 * 60 * MINUTE);
    expect((await runTick(ctx, failing)).claimed).toBe(0);
    expect(calls).toBe(6);
  });

  it("deletes finished one-off jobs and reschedules recurring polls", async () => {
    const { ctx, clock } = testCtx();
    await enqueue(ctx, { kind: "extract_diff", dedupeKey: "a" });
    await enqueue(ctx, { kind: "poll", dedupeKey: "b" });
    const report = await runTick(
      ctx,
      steps(async (_ctx, job) => (job.kind === "poll" ? { type: "reschedule", at: clock.now() + 3_600_000 } : { type: "done" })),
    );
    expect(report).toMatchObject({ claimed: 2, done: 1, rescheduled: 1 });
    const left = await ctx.db.select().from(jobs).all();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "poll", runAfter: clock.now() + 3_600_000, attempts: 0, lockedUntil: null });
  });

  it("two ticks running at once never run the same job", async () => {
    const { ctx } = testCtx({ config: { ...testCtx().ctx.config, jobsPerTick: 7, userAgent: "t" } });
    for (let i = 0; i < 20; i++) await enqueue(ctx, { kind: "extract_diff", dedupeKey: `j${i}` });
    const runs: number[] = [];
    const slow = steps(async (_ctx, job: Job) => {
      runs.push(job.id);
      await new Promise((r) => setTimeout(r, 5));
      return { type: "done" };
    });
    const reports = await Promise.all([runTick(ctx, slow), runTick(ctx, slow), runTick(ctx, slow)]);
    expect(reports.map((r) => r.claimed).reduce((a, b) => a + b)).toBe(20);
    expect(new Set(runs).size).toBe(runs.length);
    expect(runs).toHaveLength(20);
  });

  it("claims are atomic: concurrent claims return disjoint sets", async () => {
    const { ctx } = testCtx();
    for (let i = 0; i < 30; i++) await enqueue(ctx, { kind: "extract_diff", dedupeKey: `c${i}` });
    const batches = await Promise.all(Array.from({ length: 5 }, () => claimJobs(ctx, 10)));
    const ids = batches.flat().map((j) => j.id);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
  });

  it("a lock expires after 60 s so a crashed tick's jobs are picked up again", async () => {
    const { ctx, clock } = testCtx();
    await enqueue(ctx, { kind: "extract_diff", dedupeKey: "l" });
    expect(await claimJobs(ctx, 10)).toHaveLength(1);
    expect(await claimJobs(ctx, 10)).toHaveLength(0);
    clock.advance(LOCK_MS + 1);
    expect(await claimJobs(ctx, 10)).toHaveLength(1);
  });

  it("defers a second job for the same host to a later tick without counting a failure", async () => {
    const { ctx, clock } = testCtx();
    await enqueue(ctx, { kind: "poll", dedupeKey: "h1" });
    await enqueue(ctx, { kind: "poll", dedupeKey: "h2" });
    const report = await runTick(
      ctx,
      steps(async (_ctx, _job, gate) => (gate.take(["api.github.com"]) ? { type: "done" } : { type: "defer" })),
    );
    expect(report).toMatchObject({ claimed: 2, done: 1, deferred: 1 });
    const [left] = await ctx.db.select().from(jobs).all();
    expect(left.attempts).toBe(0);
    expect(left.runAfter).toBe(clock.now() + 5 * MINUTE);
  });

  it("enqueue with the same dedupe key queues once", async () => {
    const { ctx } = testCtx();
    await enqueue(ctx, { kind: "poll", dedupeKey: "poll:1" });
    await enqueue(ctx, { kind: "poll", dedupeKey: "poll:1" });
    expect(await ctx.db.select().from(jobs).all()).toHaveLength(1);
  });
});

describe("Free-plan safety", () => {
  it("parks a job whose invocations keep dying without recording a result", async () => {
    const { ctx, clock } = testCtx();
    await enqueue(ctx, { kind: "extract_diff", dedupeKey: "crash" });
    // Each claim counts an attempt and moves the job to its backoff; nothing records the
    // outcome, as if the CPU limit killed the invocation.
    for (let i = 0; i < RETRY_BACKOFF.length + 1; i++) {
      expect(await claimJobs(ctx, 10)).toHaveLength(1);
      clock.advance(LOCK_MS);
      expect(await claimJobs(ctx, 10)).toHaveLength(0);
      clock.advance(RETRY_BACKOFF[Math.min(i, RETRY_BACKOFF.length - 1)]);
    }
    let ran = false;
    const report = await runTick(ctx, steps(async () => ((ran = true), { type: "done" })));
    expect(report).toMatchObject({ claimed: 1, parked: 1 });
    expect(ran).toBe(false);
    const [job] = await ctx.db.select().from(jobs).all();
    expect(job.parkedAt).not.toBeNull();
    expect(job.lastError).toContain("CPU limit");
  });

  it("runs one heavy step per tick and does not gate API hosts", async () => {
    const { KINDS } = await import("../src/sources/kinds");
    const fake = (kind: "page" | "feed" | "npm" | "github_repo", url: string) => KINDS[kind].gate({ url } as never);
    const gate = new HostGate();
    expect(gate.take(fake("page", "https://a.example/p"))).toBe(true);
    expect(gate.take(fake("feed", "https://b.example/rss"))).toBe(false);
    expect(gate.take(fake("npm", "https://registry.npmjs.org/a/latest"))).toBe(true);
    expect(gate.take(fake("npm", "https://registry.npmjs.org/b/latest"))).toBe(true);
    expect(gate.take(fake("github_repo", "https://api.github.com/repos/a/b"))).toBe(true);
  });
});

describe("crash isolation", () => {
  it("runs a job that did not finish last time alone, handing the others back", async () => {
    const { ctx, clock } = testCtx({ config: { ...testCtx().ctx.config, jobsPerTick: 3, userAgent: "t" } });
    for (const k of ["a", "b", "c"]) await enqueue(ctx, { kind: "extract_diff", dedupeKey: k });
    // First tick dies mid-way: all three were claimed, none recorded.
    expect(await claimJobs(ctx, 3)).toHaveLength(3);
    clock.advance(RETRY_BACKOFF[0] + 1);
    const ran: number[] = [];
    const report = await runTick(ctx, steps(async (_c, job) => (ran.push(job.id), { type: "done" })));
    expect(report).toMatchObject({ claimed: 3, done: 1, deferred: 2 });
    expect(ran).toHaveLength(1);
    // The others were given their attempt back and are due again.
    const left = await ctx.db.select().from(jobs).all();
    expect(left.map((j) => j.attempts)).toEqual([1, 1]);
    expect(left.every((j) => j.runAfter <= clock.now())).toBe(true);
  });
});

describe("HostGate", () => {
  it("takes all hosts or none", () => {
    const g = new HostGate();
    expect(g.take(["a", "b"])).toBe(true);
    expect(g.take(["c", "a"])).toBe(false);
    expect(g.take(["c"])).toBe(true);
  });
});
