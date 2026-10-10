// Portability interfaces (SPEC §4.3). Platform code lives behind these so the engine can run
// on Workers (D1, R2, cron) or Node (SQLite, filesystem, setInterval).
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./db/schema";

/** Any async Drizzle SQLite database: D1 in production, libSQL/SQLite on Node. */
export type Db = BaseSQLiteDatabase<"async", unknown, typeof schema>;

export interface BlobStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<void>;
}

export interface Clock {
  /** Unix milliseconds. */
  now(): number;
}

export type CronTask = "tick" | "daily";

/** Maps whatever the platform uses to fire timers onto the two cron tasks. */
export interface Scheduler {
  start(run: (task: CronTask) => Promise<void>): void;
  stop(): void;
}

/** Outbound HTTP. Production uses global fetch; tests serve fixtures. */
export type Http = (request: Request) => Promise<Response>;

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Extra headers (List-Unsubscribe). */
  headers?: Record<string, string>;
  /** The provider drops a second send with the same key (Resend: 24 hours), so a retried step cannot send twice. */
  idempotencyKey?: string;
}

/** A send that failed. `permanent`: retrying will not help (bad address, rejected payload). */
export class MailError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "MailError";
  }
}

/** Outbound email: Resend in production (src/platform/resend.ts), console in development, memory in tests. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}
