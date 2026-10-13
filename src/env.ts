import { configFromEnv, type Ctx } from "./context";
import { AnthropicLlm } from "./llm/anthropic";
import type { Llm } from "./llm/llm";
import { d1Db, R2BlobStore, systemClock } from "./platform/cloudflare";
import { ConsoleMailer } from "./platform/memory";
import { IdempotentMailer } from "./platform/idempotent";
import { DEFAULT_FROM, ResendMailer } from "./platform/resend";
import { SesMailer } from "./platform/ses";
import type { Clock, Db, Http, Mailer } from "./ports";

export interface AppEnv extends Env {
  GITHUB_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  /** Points the Claude client elsewhere (scripts/measure-cpu.mjs uses a local stub). */
  ANTHROPIC_BASE_URL?: string;
  /** Comma-separated emails of users who may open /admin. */
  ADMIN_EMAILS?: string;
  /** GitHub OAuth app for sign-in. Unset: the GitHub button is hidden. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Origin used in emailed links. Default: the request origin on localhost, else https://stackquake.com. */
  APP_ORIGIN?: string;
  GITHUB_API_BASE?: string;
  GITHUB_RAW_BASE?: string;
  /** "1" only under `wrangler dev` (set by scripts/poll.mjs). Enables /__dev routes. */
  DEV_ROUTES?: string;
  /** Amazon SES (v2 HTTPS API, SigV4): both keys set and SES sends the mail; else Resend; else the log (ConsoleMailer). */
  AWS_SES_ACCESS_KEY_ID?: string;
  AWS_SES_SECRET_ACCESS_KEY?: string;
  /** Default eu-west-1. */
  AWS_SES_REGION?: string;
  /** Points the SES client elsewhere (scripts/measure-cpu.mjs uses a local stub). */
  AWS_SES_API_BASE?: string;
  /** Resend API key, the fallback while SES is not configured. */
  RESEND_API_KEY?: string;
  /** Sender, e.g. "Stackquake <alerts@stackquake.com>". Before DNS (M5): "Stackquake <onboarding@resend.dev>". */
  MAIL_FROM?: string;
  /** Points the Resend client elsewhere (scripts/measure-cpu.mjs uses a local stub). */
  RESEND_API_BASE?: string;
  /** HMAC key for one-click links in alerts. */
  LINK_SECRET?: string;
  /** AES-GCM key (32 bytes, base64) for Slack webhook URLs. */
  CHANNEL_KEY?: string;
  LLM_WEEKLY_BUDGET_USD?: string;
  /** GitHub App for private repos (M5): slug and client ID are vars; the rest are secrets. All five or none. */
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  /** PEM as GitHub issues it (PKCS#1) or PKCS#8. */
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  /** "1" on staging: /admin/staging runs ticks by hand and adds sample events (no cron there). */
  STAGING_TOOLS?: string;
  /** Stripe (M6): restricted key, webhook signing secret and the Team prices. All four or billing is off. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  STRIPE_API_BASE?: string;
}

const noLlm: Llm = {
  complete: () => Promise.reject(new Error("ANTHROPIC_API_KEY is not set")),
};

export function makeLlm(env: AppEnv): Llm {
  return env.ANTHROPIC_API_KEY ? new AnthropicLlm(env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) : noLlm;
}

let warnedBoth = false;

/**
 * SES when both AWS keys are set, else Resend, else the log. SES has no idempotency key, so with
 * `store` (the D1 and clock of the invocation) it is wrapped in IdempotentMailer; Resend has its own.
 */
export function makeMailer(env: AppEnv, http: Http, store?: { db: Db; clock: Clock }): Mailer {
  const from = env.MAIL_FROM || DEFAULT_FROM;
  if (env.AWS_SES_ACCESS_KEY_ID && env.AWS_SES_SECRET_ACCESS_KEY) {
    if (env.RESEND_API_KEY && !warnedBoth) {
      warnedBoth = true;
      console.log("[mail] both Amazon SES and Resend are configured; sending with SES (unset the AWS_SES keys to fall back)");
    }
    const ses = new SesMailer({ accessKeyId: env.AWS_SES_ACCESS_KEY_ID, secretAccessKey: env.AWS_SES_SECRET_ACCESS_KEY, region: env.AWS_SES_REGION, from, http, base: env.AWS_SES_API_BASE });
    return store ? new IdempotentMailer(ses, store.db, store.clock) : ses;
  }
  return env.RESEND_API_KEY ? new ResendMailer({ apiKey: env.RESEND_API_KEY, from, http, base: env.RESEND_API_BASE }) : new ConsoleMailer();
}

/** Production wiring: D1, R2, the system clock, global fetch, the Claude API and Amazon SES (or Resend). */
export function makeCtx(env: AppEnv): Ctx {
  const http: Http = (req) => fetch(req);
  const db = d1Db(env.DB);
  return {
    db,
    blobs: new R2BlobStore(env.SNAPSHOTS),
    clock: systemClock,
    http,
    llm: makeLlm(env),
    mailer: makeMailer(env, http, { db, clock: systemClock }),
    config: configFromEnv(env),
  };
}
