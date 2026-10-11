// Sessions, CSRF and rate limits (SPEC §8). Session cookies are random tokens; D1 stores only
// their sha256, so reading the database does not give anyone a live session. The CSRF token for a
// signed-in user is derived from the session token; before sign-in it is a double-submit cookie.
import { eq, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { accountOf, type Account } from "../billing/plans";
import type { Ctx } from "../context";
import { sessions, users, type User } from "../db/schema";
import type { AppEnv } from "../env";
import { DAY, safeEqual, sha256Hex } from "../util";

export type WebEnv = {
  Bindings: AppEnv;
  Variables: { ctx: Ctx; user: User | null; csrf: string; account?: Account };
};
export type WebContext = Context<WebEnv>;

/** The signed-in user's plan and project scope (src/billing/plans.ts), loaded once per request. */
export async function getAccount(c: WebContext): Promise<Account> {
  let a = c.get("account");
  if (!a) {
    a = await accountOf(c.get("ctx"), c.get("user")!);
    c.set("account", a);
  }
  return a;
}

export const SESSION_COOKIE = "sq_session";
export const CSRF_COOKIE = "sq_csrf";
export const SESSION_MS = 30 * DAY;

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const cookieOpts = { httpOnly: true, secure: true, sameSite: "Lax" as const, path: "/" };

export async function createSession(c: WebContext, userId: number): Promise<void> {
  const ctx = c.get("ctx");
  const token = randomToken();
  const now = ctx.clock.now();
  await ctx.db.insert(sessions).values({ id: await sha256Hex(token), userId, expiresAt: now + SESSION_MS, createdAt: now });
  setCookie(c, SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_MS / 1000 });
}

export async function endSession(c: WebContext): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.get("ctx").db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
  deleteCookie(c, SESSION_COOKIE, cookieOpts);
}

/** Loads the user, sets the CSRF token and checks it on every POST (SPEC §8). */
export function sessionMiddleware(makeCtx: (env: AppEnv) => Ctx): MiddlewareHandler<WebEnv> {
  return async (c, next) => {
    const ctx = makeCtx(c.env);
    c.set("ctx", ctx);
    const token = getCookie(c, SESSION_COOKIE);
    let user: User | null = null;
    if (token && token.length <= 128) {
      const row = await ctx.db
        .select({ user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(sql`${sessions.id} = ${await sha256Hex(token)} AND ${sessions.expiresAt} > ${ctx.clock.now()}`)
        .get();
      user = row?.user ?? null;
      if (!user) deleteCookie(c, SESSION_COOKIE, cookieOpts);
    }
    c.set("user", user);
    let csrf: string;
    if (user) csrf = (await sha256Hex(`csrf:${token}`)).slice(0, 32);
    else {
      csrf = getCookie(c, CSRF_COOKIE) ?? "";
      if (!/^[\w-]{20,64}$/.test(csrf)) {
        csrf = randomToken(18);
        setCookie(c, CSRF_COOKIE, csrf, { ...cookieOpts, maxAge: DAY / 1000 });
      }
    }
    c.set("csrf", csrf);
    if (c.req.method === "POST") {
      // Same-origin check first (cheap, and catches forms posted from other sites).
      const origin = c.req.header("origin");
      if (origin && origin !== new URL(c.req.url).origin) return c.text("Cross-site request refused", 403);
      const form = await c.req.parseBody();
      if (typeof form._csrf !== "string" || !safeEqual(form._csrf, csrf)) return c.text("Bad or missing CSRF token. Reload the page and try again.", 403);
    }
    await next();
  };
}

export const requireUser: MiddlewareHandler<WebEnv> = async (c, next) => {
  if (!c.get("user")) return c.req.method === "GET" ? c.redirect(`/signin?next=${encodeURIComponent(new URL(c.req.url).pathname)}`) : c.text("Not signed in", 401);
  await next();
};

export function adminEmails(env: AppEnv): Set<string> {
  return new Set((env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export const isAdmin = (c: WebContext) => {
  const u = c.get("user");
  return !!u && adminEmails(c.env).has(u.email.toLowerCase());
};

/** Admin pages are invisible (404) to everyone not in ADMIN_EMAILS. */
export const requireAdmin: MiddlewareHandler<WebEnv> = async (c, next) => {
  if (!c.get("user")) return c.req.method === "GET" ? c.redirect(`/signin?next=${encodeURIComponent(new URL(c.req.url).pathname)}`) : c.text("Not signed in", 401);
  if (!isAdmin(c)) return c.notFound();
  await next();
};

/** Origin for links in email. Never taken from a production request's Host header. */
export function appOrigin(c: WebContext): string {
  if (c.env.APP_ORIGIN) return c.env.APP_ORIGIN.replace(/\/$/, "");
  const url = new URL(c.req.url);
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? url.origin : "https://stackquake.com";
}

/** Only same-site paths are followed after sign-in. */
export function safeNext(next: string | undefined | null): string {
  return next && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) && !next.startsWith("/\\") ? next : "/app";
}

/**
 * Fixed-window counter. Returns true while the key is under `limit` hits in the window
 * (and counts this hit), false once it is over.
 */
export async function hitRateLimit(ctx: Ctx, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = ctx.clock.now();
  const [row] = await ctx.db.all<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${now}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN window_start <= ${now - windowMs} THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN window_start <= ${now - windowMs} THEN ${now} ELSE window_start END
    RETURNING count`);
  return row.count <= limit;
}

export const clientIp = (c: WebContext) => c.req.header("cf-connecting-ip") ?? "unknown";
