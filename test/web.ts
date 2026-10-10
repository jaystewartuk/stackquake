// Drives the HTTP app like a browser: keeps cookies, fills in the CSRF token, signs in through
// the real magic-link flow.
import { env } from "cloudflare:test";
import { syncCatalog } from "../src/catalog/catalog";
import { CATALOG } from "../src/catalog/entries";
import type { Ctx } from "../src/context";
import type { AppEnv } from "../src/env";
import { sha256Hex } from "../src/util";
import { createApp } from "../src/web";
import { testCtx } from "./helpers";

export const ORIGIN = "https://stackquake.test";
export const ADMIN = "owner@example.com";

export function testEnv(over: Partial<AppEnv> = {}): AppEnv {
  return { ...(env as unknown as AppEnv), ADMIN_EMAILS: ADMIN, ...over };
}

export class Browser {
  readonly cookies = new Map<string, string>();
  readonly app: ReturnType<typeof createApp>;
  ip = "203.0.113.7";

  constructor(
    readonly ctx: Ctx,
    readonly env: AppEnv = testEnv(),
  ) {
    this.app = createApp(() => ctx);
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    headers.set("cf-connecting-ip", this.ip);
    const res = await this.app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" }), this.env, { waitUntil() {}, passThroughOnException() {} } as never);
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => /max-age=0\b/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  get(path: string) {
    return this.fetch(path);
  }

  async html(path: string): Promise<string> {
    const res = await this.get(path);
    if (res.status !== 200) throw new Error(`GET ${path}: ${res.status} ${res.headers.get("location") ?? ""}`);
    return res.text();
  }

  /** The CSRF token the server expects from this browser. */
  async csrf(): Promise<string> {
    const session = this.cookies.get("sq_session");
    if (session) return (await sha256Hex(`csrf:${session}`)).slice(0, 32);
    if (!this.cookies.get("sq_csrf")) await this.get("/signin");
    return this.cookies.get("sq_csrf")!;
  }

  async post(path: string, fields: Record<string, string | string[]> = {}, opts: { csrf?: string | null } = {}): Promise<Response> {
    const body = new URLSearchParams();
    const token = opts.csrf === undefined ? await this.csrf() : opts.csrf;
    if (token !== null) body.set("_csrf", token);
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
    return this.fetch(path, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  }

  /** The magic-link flow end to end. */
  async signIn(email: string): Promise<void> {
    const res = await this.post("/auth/email", { email });
    if (res.status !== 200) throw new Error(`sign-in request: ${res.status}`);
    const token = lastToken(this.ctx);
    const confirm = await this.post("/auth/email/confirm", { token });
    if (confirm.status !== 302) throw new Error(`confirm: ${confirm.status} ${await confirm.text()}`);
  }
}

export function lastToken(ctx: Ctx): string {
  const mail = (ctx.mailer as unknown as { last(): { text: string } | undefined }).last();
  const m = /token=([\w-]+)/.exec(mail?.text ?? "");
  if (!m) throw new Error("no magic link sent");
  return m[1];
}

/** A test context with the catalog synced (so catalog deps have sources to link). */
export async function webCtx(overrides: Parameters<typeof testCtx>[0] = {}) {
  const t = testCtx(overrides);
  await syncCatalog(t.ctx, CATALOG);
  return t;
}

export const location = (res: Response) => res.headers.get("location");
