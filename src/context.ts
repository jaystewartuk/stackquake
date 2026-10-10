import type { Llm } from "./llm/llm";
import type { BlobStore, Clock, Db, Http, Mailer } from "./ports";

export interface LlmModels {
  /** All feed classification. */
  classify: string;
  /** Notes for pricing, free tier, deprecated, archived, other, and page diffs. */
  summarise: string;
  /** Notes for the kinds where a wrong note hurts most (HIGH_STAKES_KINDS). */
  summariseHigh: string;
}

export interface Config {
  jobsPerTick: number;
  userAgent: string;
  githubToken?: string;
  models: LlmModels;
  /** GitHub REST API and raw file hosts (repo import). Overridable so measure-cpu can stub them. */
  githubApi: string;
  githubRaw: string;
}

/** Everything a step needs. Built once per invocation. */
export interface Ctx {
  db: Db;
  blobs: BlobStore;
  clock: Clock;
  http: Http;
  llm: Llm;
  mailer: Mailer;
  config: Config;
}

export const USER_AGENT = "StackquakeBot/1.0 (+https://stackquake.com/bot)";

/** Owner's split (docs/DECISIONS.md, "Before M2"): Haiku for volume, Opus where a wrong note hurts most. */
export const DEFAULT_MODELS: LlmModels = {
  classify: "claude-haiku-5-5",
  summarise: "claude-haiku-5-5",
  summariseHigh: "claude-opus-5-5",
};

export interface ConfigEnv {
  JOBS_PER_TICK?: string;
  GITHUB_TOKEN?: string;
  LLM_MODEL_CLASSIFY?: string;
  LLM_MODEL_SUMMARISE?: string;
  LLM_MODEL_SUMMARISE_HIGH?: string;
  GITHUB_API_BASE?: string;
  GITHUB_RAW_BASE?: string;
}

export const GITHUB_API = "https://api.github.com";
export const GITHUB_RAW = "https://raw.githubusercontent.com";

export function configFromEnv(env: ConfigEnv): Config {
  const n = Number(env.JOBS_PER_TICK ?? "3");
  return {
    jobsPerTick: Number.isInteger(n) && n > 0 ? n : 3,
    userAgent: USER_AGENT,
    githubToken: env.GITHUB_TOKEN || undefined,
    models: {
      classify: env.LLM_MODEL_CLASSIFY || DEFAULT_MODELS.classify,
      summarise: env.LLM_MODEL_SUMMARISE || DEFAULT_MODELS.summarise,
      summariseHigh: env.LLM_MODEL_SUMMARISE_HIGH || DEFAULT_MODELS.summariseHigh,
    },
    githubApi: env.GITHUB_API_BASE || GITHUB_API,
    githubRaw: env.GITHUB_RAW_BASE || GITHUB_RAW,
  };
}
