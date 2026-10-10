import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { BlobStore, Clock, CronTask, Db, Scheduler } from "../ports";

export function d1Db(d1: D1Database): Db {
  return drizzle(d1, { schema }) as unknown as Db;
}

export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2Bucket) {}

  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    await this.bucket.put(key, body);
  }

  async has(key: string): Promise<boolean> {
    return (await this.bucket.head(key)) !== null;
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length) await this.bucket.delete(keys);
  }
}

export const systemClock: Clock = { now: () => Date.now() };

export const CRON_TICK = "*/5 * * * *";
/**
 * A second tick, 3 minutes after each first one (docs/DECISIONS.md, M4: capacity). Each cron
 * invocation has its own 10 ms CPU budget and its own HEAVY token, so this doubles what the
 * runner can do per day on the Free plan. Minutes ≡ 3 (mod 5) keep clear of the daily run at :07.
 */
export const CRON_TICK_2 = "3-58/5 * * * *";
// Off the 5-minute grid, so the daily prune never overlaps a tick.
export const CRON_DAILY = "7 6 * * *";

export function cronTask(cron: string): CronTask {
  if (cron === CRON_TICK || cron === CRON_TICK_2) return "tick";
  if (cron === CRON_DAILY) return "daily";
  throw new Error(`unknown cron ${cron}`);
}

/**
 * On Workers the platform owns the timer: the `scheduled()` handler calls `dispatch()`.
 * start/stop exist to satisfy the interface used by the Node entry point.
 */
export class CronScheduler implements Scheduler {
  private run: ((task: CronTask) => Promise<void>) | null = null;

  start(run: (task: CronTask) => Promise<void>): void {
    this.run = run;
  }

  stop(): void {
    this.run = null;
  }

  dispatch(cron: string): Promise<void> {
    if (!this.run) throw new Error("scheduler not started");
    return this.run(cronTask(cron));
  }
}
