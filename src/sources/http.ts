// Polite HTTP (SPEC §5 "Politeness"): our User-Agent, conditional requests, robots.txt,
// challenge detection, and capped body reads.
import { eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { robots } from "../db/schema";
import { DAY } from "../util";
import { robotsAllows } from "./robots";

export type FetchOutcome =
  | { type: "ok"; status: number; body: Uint8Array; contentType: string; etag: string | null; lastModified: string | null; truncated: boolean; url: string }
  | { type: "not_modified"; status: 304 }
  /** 403, a bot challenge, or robots.txt says no. Counts toward the `blocked` state. */
  | { type: "blocked"; status: number; reason: string }
  /** 429, 5xx, network errors, other 4xx: back off and try later. */
  | { type: "retry"; status: number; reason: string; retryAfterMs: number | null }
  | { type: "too_large"; status: number; reason: string };

export interface FetchOptions {
  accept?: string;
  etag?: string | null;
  lastModified?: string | null;
  headers?: Record<string, string>;
  maxBytes: number;
  /** Return the first maxBytes instead of failing (feeds: newest items come first). */
  truncateOk?: boolean;
  robots?: boolean;
}

const ROBOTS_TTL = DAY;
const AGENT_TOKEN = "stackquakebot";

export function hostOf(url: string): string {
  return new URL(url).host.toLowerCase();
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** Cloudflare, Vercel and similar bot walls. */
function challengeReason(res: Response): string | null {
  if (res.headers.get("cf-mitigated") === "challenge") return "Cloudflare challenge";
  if (res.headers.get("x-vercel-mitigated") === "challenge") return "Vercel Security Checkpoint";
  if (res.headers.get("x-amzn-waf-action") === "challenge" || res.headers.get("x-amzn-waf-action") === "captcha") return "AWS WAF challenge";
  return null;
}

async function readCapped(res: Response, maxBytes: number, truncateOk: boolean): Promise<{ body: Uint8Array; truncated: boolean } | null> {
  const declared = Number(res.headers.get("content-length") ?? "NaN");
  if (!truncateOk && Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return { body: new Uint8Array(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      if (!truncateOk) {
        await reader.cancel();
        return null;
      }
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const body = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.byteLength;
  }
  return { body, truncated };
}

async function robotsBody(ctx: Ctx, url: string): Promise<string | { retry: string }> {
  const host = hostOf(url);
  const now = ctx.clock.now();
  const cached = await ctx.db.select().from(robots).where(eq(robots.host, host)).get();
  if (cached && now - cached.fetchedAt < ROBOTS_TTL) return cached.body;

  let body = "";
  try {
    const res = await ctx.http(new Request(`${new URL(url).origin}/robots.txt`, { headers: { "user-agent": ctx.config.userAgent }, redirect: "follow" }));
    if (res.status >= 500 || res.status === 429) {
      await res.body?.cancel();
      return { retry: `robots.txt returned ${res.status}` };
    }
    // RFC 9309: any other 4xx means no restrictions.
    if (res.ok) body = new TextDecoder().decode((await readCapped(res, 512_000, true))?.body);
    else await res.body?.cancel();
  } catch (e) {
    return { retry: `robots.txt: ${e instanceof Error ? e.message : String(e)}` };
  }
  await ctx.db
    .insert(robots)
    .values({ host, body, fetchedAt: now })
    .onConflictDoUpdate({ target: robots.host, set: { body, fetchedAt: now } });
  return body;
}

export async function politeFetch(ctx: Ctx, url: string, opts: FetchOptions): Promise<FetchOutcome> {
  if (opts.robots) {
    const body = await robotsBody(ctx, url);
    if (typeof body !== "string") return { type: "retry", status: 0, reason: body.retry, retryAfterMs: null };
    if (!robotsAllows(body, AGENT_TOKEN, url)) return { type: "blocked", status: 0, reason: "disallowed by robots.txt" };
  }

  const headers = new Headers({ "user-agent": ctx.config.userAgent, ...opts.headers });
  if (opts.accept) headers.set("accept", opts.accept);
  if (opts.etag) headers.set("if-none-match", opts.etag);
  if (opts.lastModified) headers.set("if-modified-since", opts.lastModified);

  let res: Response;
  try {
    res = await ctx.http(new Request(url, { headers, redirect: "follow" }));
  } catch (e) {
    return { type: "retry", status: 0, reason: `network: ${e instanceof Error ? e.message : String(e)}`, retryAfterMs: null };
  }

  // GitHub answers an exhausted rate limit with 403; that is "later", not "blocked".
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    await res.body?.cancel();
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const wait = Number.isFinite(reset) ? Math.max(0, reset * 1000 - ctx.clock.now()) : null;
    return { type: "retry", status: res.status, reason: "rate limited", retryAfterMs: wait };
  }

  const challenge = challengeReason(res);
  if (challenge || res.status === 403) {
    await res.body?.cancel();
    return { type: "blocked", status: res.status, reason: challenge ?? "HTTP 403" };
  }
  if (res.status === 304) return { type: "not_modified", status: 304 };
  if (res.status === 429 || res.status >= 500) {
    await res.body?.cancel();
    return { type: "retry", status: res.status, reason: `HTTP ${res.status}`, retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), ctx.clock.now()) };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { type: "retry", status: res.status, reason: `HTTP ${res.status}`, retryAfterMs: null };
  }

  const read = await readCapped(res, opts.maxBytes, opts.truncateOk ?? false);
  if (!read) return { type: "too_large", status: res.status, reason: `body over ${opts.maxBytes} bytes` };
  return {
    type: "ok",
    status: res.status,
    body: read.body,
    truncated: read.truncated,
    contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    url: res.url || url,
  };
}
