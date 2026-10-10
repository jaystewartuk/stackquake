import { configFromEnv, type Ctx } from "./context";
import { AnthropicLlm } from "./llm/anthropic";
import type { Llm } from "./llm/llm";
import { d1Db, R2BlobStore, systemClock } from "./platform/cloudflare";

export interface AppEnv extends Env {
  GITHUB_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  /** Points the Claude client elsewhere (scripts/measure-cpu.mjs uses a local stub). */
  ANTHROPIC_BASE_URL?: string;
  LLM_MODEL_CLASSIFY?: string;
  LLM_MODEL_SUMMARISE?: string;
  LLM_MODEL_SUMMARISE_HIGH?: string;
  /** Protects /admin until M3 adds real auth. Unset: /admin is off. */
  ADMIN_TOKEN?: string;
  /** "1" only under `wrangler dev` (set by scripts/poll.mjs). Enables /__dev routes. */
  DEV_ROUTES?: string;
}

const noLlm: Llm = {
  complete: () => Promise.reject(new Error("ANTHROPIC_API_KEY is not set")),
};

export function makeLlm(env: AppEnv): Llm {
  return env.ANTHROPIC_API_KEY ? new AnthropicLlm(env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) : noLlm;
}

/** Production wiring: D1, R2, the system clock, global fetch and the Claude API. */
export function makeCtx(env: AppEnv): Ctx {
  return {
    db: d1Db(env.DB),
    blobs: new R2BlobStore(env.SNAPSHOTS),
    clock: systemClock,
    http: (req) => fetch(req),
    llm: makeLlm(env),
    config: configFromEnv(env),
  };
}
