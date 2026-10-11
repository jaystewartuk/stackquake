import type { GithubAppConfig } from "./github/app";
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
  /** Fan-out, delivery and digest jobs per tick, on top of jobsPerTick. */
  alertJobsPerTick: number;
  userAgent: string;
  githubToken?: string;
  models: LlmModels;
  /** GitHub REST API and raw file hosts (repo import). Overridable so measure-cpu can stub them. */
  githubApi: string;
  githubRaw: string;
  /** Origin for links in email and Slack (no request to take it from in a cron step). */
  appOrigin: string;
  /** HMAC key for one-click links in alerts (LINK_SECRET). Unset: alerts go out without them. */
  linkSecret?: string;
  /** AES-GCM key for Slack webhook URLs (CHANNEL_KEY, 32 bytes base64). Unset: Slack is off. */
  channelKey?: string;
  /** SPEC §7.4: email the admins above this 7-day LLM cost; pause classify above twice it. */
  llmWeeklyBudgetUsd: number;
  adminEmails: string[];
  /** GitHub App for private repos (M5). Unset: private import is hidden. */
  githubApp?: GithubAppConfig;
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
  ALERT_JOBS_PER_TICK?: string;
  GITHUB_TOKEN?: string;
  LLM_MODEL_CLASSIFY?: string;
  LLM_MODEL_SUMMARISE?: string;
  LLM_MODEL_SUMMARISE_HIGH?: string;
  GITHUB_API_BASE?: string;
  GITHUB_RAW_BASE?: string;
  APP_ORIGIN?: string;
  LINK_SECRET?: string;
  CHANNEL_KEY?: string;
  LLM_WEEKLY_BUDGET_USD?: string;
  ADMIN_EMAILS?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
}

export const DEFAULT_ORIGIN = "https://stackquake.com";
export const DEFAULT_WEEKLY_BUDGET_USD = 10;

export const parseEmails = (s: string | undefined) => (s ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const GITHUB_API = "https://api.github.com";
export const GITHUB_RAW = "https://raw.githubusercontent.com";

export function configFromEnv(env: ConfigEnv): Config {
  const n = Number(env.JOBS_PER_TICK ?? "3");
  const a = Number(env.ALERT_JOBS_PER_TICK ?? "2");
  return {
    jobsPerTick: Number.isInteger(n) && n > 0 ? n : 3,
    alertJobsPerTick: Number.isInteger(a) && a >= 0 ? a : 2,
    userAgent: USER_AGENT,
    githubToken: env.GITHUB_TOKEN || undefined,
    models: {
      classify: env.LLM_MODEL_CLASSIFY || DEFAULT_MODELS.classify,
      summarise: env.LLM_MODEL_SUMMARISE || DEFAULT_MODELS.summarise,
      summariseHigh: env.LLM_MODEL_SUMMARISE_HIGH || DEFAULT_MODELS.summariseHigh,
    },
    githubApi: env.GITHUB_API_BASE || GITHUB_API,
    githubRaw: env.GITHUB_RAW_BASE || GITHUB_RAW,
    appOrigin: (env.APP_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, ""),
    linkSecret: env.LINK_SECRET || undefined,
    channelKey: env.CHANNEL_KEY || undefined,
    llmWeeklyBudgetUsd: Number(env.LLM_WEEKLY_BUDGET_USD) > 0 ? Number(env.LLM_WEEKLY_BUDGET_USD) : DEFAULT_WEEKLY_BUDGET_USD,
    adminEmails: parseEmails(env.ADMIN_EMAILS),
    githubApp:
      env.GITHUB_APP_SLUG && env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET
        ? { slug: env.GITHUB_APP_SLUG, clientId: env.GITHUB_APP_CLIENT_ID, clientSecret: env.GITHUB_APP_CLIENT_SECRET, privateKey: env.GITHUB_APP_PRIVATE_KEY, webhookSecret: env.GITHUB_WEBHOOK_SECRET }
        : undefined,
  };
}
