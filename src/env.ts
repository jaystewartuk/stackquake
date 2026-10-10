import { configFromEnv, type Ctx } from "./context";
import { d1Db, R2BlobStore, systemClock } from "./platform/cloudflare";

export interface AppEnv extends Env {
  GITHUB_TOKEN?: string;
  /** "1" only under `wrangler dev` (set by scripts/poll.mjs). Enables /__dev routes. */
  DEV_ROUTES?: string;
}

/** Production wiring: D1, R2, the system clock and global fetch. */
export function makeCtx(env: AppEnv): Ctx {
  return {
    db: d1Db(env.DB),
    blobs: new R2BlobStore(env.SNAPSHOTS),
    clock: systemClock,
    http: (req) => fetch(req),
    config: configFromEnv(env),
  };
}
