import type { BlobStore, Clock, Db, Http } from "./ports";

export interface Config {
  jobsPerTick: number;
  userAgent: string;
  githubToken?: string;
}

/** Everything a step needs. Built once per invocation. */
export interface Ctx {
  db: Db;
  blobs: BlobStore;
  clock: Clock;
  http: Http;
  config: Config;
}

export const USER_AGENT = "StackquakeBot/1.0 (+https://stackquake.com/bot)";

export function configFromEnv(env: { JOBS_PER_TICK?: string; GITHUB_TOKEN?: string }): Config {
  const n = Number(env.JOBS_PER_TICK ?? "3");
  return {
    jobsPerTick: Number.isInteger(n) && n > 0 ? n : 3,
    userAgent: USER_AGENT,
    githubToken: env.GITHUB_TOKEN || undefined,
  };
}
