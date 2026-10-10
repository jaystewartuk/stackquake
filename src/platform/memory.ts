// In-memory implementations for tests (and the Node entry point later).
import type { BlobStore, Clock, CronTask, Scheduler } from "../ports";

export class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>();

  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
  async put(key: string, body: Uint8Array) {
    this.blobs.set(key, body);
  }
  async has(key: string) {
    return this.blobs.has(key);
  }
  async delete(keys: string[]) {
    for (const k of keys) this.blobs.delete(k);
  }
}

export class FakeClock implements Clock {
  constructor(private t = Date.UTC(2026, 9, 10, 12, 0, 0)) {}
  now() {
    return this.t;
  }
  set(t: number) {
    this.t = t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** setInterval-based scheduler: a tick every 5 minutes, the daily task every 24 hours. */
export class IntervalScheduler implements Scheduler {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private readonly tickMs = 5 * 60_000, private readonly dailyMs = 24 * 3_600_000) {}

  start(run: (task: CronTask) => Promise<void>): void {
    this.timers.push(setInterval(() => void run("tick"), this.tickMs));
    this.timers.push(setInterval(() => void run("daily"), this.dailyMs));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}

/** Test scheduler: tasks run only when the test calls fire(). */
export class ManualScheduler implements Scheduler {
  private run: ((task: CronTask) => Promise<void>) | null = null;
  start(run: (task: CronTask) => Promise<void>) {
    this.run = run;
  }
  stop() {
    this.run = null;
  }
  fire(task: CronTask) {
    if (!this.run) throw new Error("scheduler not started");
    return this.run(task);
  }
}
