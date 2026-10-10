// Job runner (SPEC §7.2): claim a batch, run one step per job, record the outcome.
import type { Ctx } from "../context";
import type { Job, JobKind } from "../db/schema";
import { HEAVY } from "../sources/http";
import { KINDS } from "../sources/kinds";
import { errorMessage, MINUTE } from "../util";
import { extractDiff } from "../watch/extract-diff";
import { getSource, pollSource } from "../watch/poll";
import { claimJobs, completeJob, deferJob, failJob, parkJob, RETRY_BACKOFF, rescheduleJob } from "./queue";

export type StepResult = { type: "done" } | { type: "reschedule"; at: number } | { type: "defer" };

/**
 * Per-tick exclusive tokens: one request per website host (SPEC §5 "Politeness") and one
 * CPU-heavy step per tick, which keeps a tick inside the Free plan's 10 ms CPU limit.
 */
export class HostGate {
  private readonly used = new Set<string>();
  /** Takes all hosts or none. Synchronous, so jobs running concurrently cannot both win. */
  take(hosts: string[]): boolean {
    if (hosts.some((h) => this.used.has(h))) return false;
    for (const h of hosts) this.used.add(h);
    return true;
  }
}

export type StepHandler = (ctx: Ctx, job: Job, gate: HostGate) => Promise<StepResult>;

export const STEPS: Record<JobKind, StepHandler> = {
  async poll(ctx, job, gate) {
    const source = job.sourceId === null ? undefined : await getSource(ctx, job.sourceId);
    if (!source || source.state !== "active") return { type: "done" };
    if (!gate.take(KINDS[source.kind].gate(source))) return { type: "defer" };
    const report = await pollSource(ctx, source);
    const after = await getSource(ctx, source.id);
    return after?.state === "active" ? { type: "reschedule", at: report.nextPollAt } : { type: "done" };
  },
  async extract_diff(ctx, job, gate) {
    const source = job.sourceId === null ? undefined : await getSource(ctx, job.sourceId);
    const p = job.payload as { oldSha?: string; newSha?: string } | null;
    if (!source || !p?.oldSha || !p.newSha) return { type: "done" };
    if (!gate.take([HEAVY])) return { type: "defer" };
    await extractDiff(ctx, source, p.oldSha, p.newSha);
    return { type: "done" };
  },
};

export interface TickReport {
  claimed: number;
  /** Source of each claimed job, for logs. */
  sources: (number | null)[];
  done: number;
  rescheduled: number;
  deferred: number;
  retried: number;
  parked: number;
}

const DEFER_MS = 5 * MINUTE;

export async function runJob(ctx: Ctx, job: Job, gate: HostGate, steps: Record<JobKind, StepHandler>, report: TickReport): Promise<void> {
  // Claims count attempts, so a step that kills its invocation (CPU limit, crash) and never
  // records a result still runs out of attempts instead of looping every tick.
  if (job.attempts > RETRY_BACKOFF.length + 1) {
    await parkJob(ctx, job, job.lastError ?? "invocation ended without recording a result (CPU limit?)");
    report.parked++;
    return;
  }
  let result: StepResult;
  try {
    result = await steps[job.kind](ctx, job, gate);
  } catch (e) {
    const outcome = await failJob(ctx, job, errorMessage(e));
    report[outcome === "parked" ? "parked" : "retried"]++;
    console.error(`job ${job.id} (${job.kind}) failed, ${outcome}: ${errorMessage(e)}`);
    return;
  }
  if (result.type === "done") {
    await completeJob(ctx, job);
    report.done++;
  } else if (result.type === "reschedule") {
    await rescheduleJob(ctx, job, result.at);
    report.rescheduled++;
  } else {
    await deferJob(ctx, job, DEFER_MS);
    report.deferred++;
  }
}

/** The 5-minute cron: claim up to JOBS_PER_TICK due jobs and run one step for each. */
export async function runTick(ctx: Ctx, steps: Record<JobKind, StepHandler> = STEPS): Promise<TickReport> {
  const claimed = await claimJobs(ctx, ctx.config.jobsPerTick);
  const report: TickReport = { claimed: claimed.length, sources: claimed.map((j) => j.sourceId), done: 0, rescheduled: 0, deferred: 0, retried: 0, parked: 0 };
  const gate = new HostGate();
  // A job that did not finish cleanly last time may be one that kills the invocation (CPU
  // limit). Run it alone, after handing the others back, so it cannot take them down with it.
  const suspect = claimed.find((j) => j.attempts >= 2);
  if (suspect) {
    for (const job of claimed) {
      if (job === suspect) continue;
      await deferJob(ctx, job, 0);
      report.deferred++;
    }
    await runJob(ctx, suspect, gate, steps, report);
    return report;
  }
  await Promise.all(claimed.map((job) => runJob(ctx, job, gate, steps, report)));
  return report;
}
