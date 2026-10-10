import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { magicLinks, sessions, users } from "../src/db/schema";
import { MINUTE, sha256Hex } from "../src/util";
import { EMAIL_LIMIT, IP_LIMIT } from "../src/web/auth";
import { SESSION_MS } from "../src/web/session";
import { resetDb, testCtx } from "./helpers";
import { Browser, lastToken, location, testEnv } from "./web";

beforeEach(resetDb);

describe("magic links", () => {
  it("signs a new user in and sets a Lax, HttpOnly, Secure session cookie", async () => {
    const { ctx, mailer } = testCtx();
    const b = new Browser(ctx);
    const res = await b.post("/auth/email", { email: "  Ada@Example.com " });
    expect(res.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last()!.to).toBe("ada@example.com");
    const token = lastToken(ctx);
    // Only the hash is stored.
    const row = (await ctx.db.select().from(magicLinks).get())!;
    expect(row.tokenHash).toBe(await sha256Hex(token));
    expect(row.tokenHash).not.toContain(token);

    // Opening the link does not use it up (mail scanners prefetch links).
    expect((await b.get(`/auth/email/confirm?token=${token}`)).status).toBe(200);
    const confirm = await b.post("/auth/email/confirm", { token });
    expect(confirm.status).toBe(302);
    expect(location(confirm)).toBe("/app");
    const cookie = confirm.headers.getSetCookie().find((c) => c.startsWith("sq_session="))!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect((await ctx.db.select().from(users).all()).map((u) => u.email)).toEqual(["ada@example.com"]);
    expect((await b.get("/app")).status).toBe(302); // no projects yet → /app/projects/new
    expect(location(await b.get("/app"))).toBe("/app/projects/new");
  });

  it("is single-use", async () => {
    const { ctx } = testCtx();
    const b = new Browser(ctx);
    await b.post("/auth/email", { email: "ada@example.com" });
    const token = lastToken(ctx);
    expect((await b.post("/auth/email/confirm", { token })).status).toBe(302);
    const other = new Browser(ctx);
    const again = await other.post("/auth/email/confirm", { token });
    expect(again.status).toBe(400);
    expect(other.cookies.has("sq_session")).toBe(false);
    expect((await other.get(`/auth/email/confirm?token=${token}`)).status).toBe(400);
  });

  it("expires after 15 minutes", async () => {
    const { ctx, clock } = testCtx();
    const b = new Browser(ctx);
    await b.post("/auth/email", { email: "ada@example.com" });
    const token = lastToken(ctx);
    clock.advance(15 * MINUTE + 1);
    expect((await b.post("/auth/email/confirm", { token })).status).toBe(400);
    expect(b.cookies.has("sq_session")).toBe(false);
  });

  it("rejects unknown tokens and bad emails", async () => {
    const { ctx, mailer } = testCtx();
    const b = new Browser(ctx);
    expect((await b.post("/auth/email/confirm", { token: "nope" })).status).toBe(400);
    expect((await b.post("/auth/email", { email: "not-an-email" })).status).toBe(400);
    expect(mailer.sent).toHaveLength(0);
  });

  it("rate-limits requests per email and per IP", async () => {
    const { ctx, mailer, clock } = testCtx();
    const b = new Browser(ctx);
    for (let i = 0; i < EMAIL_LIMIT; i++) expect((await b.post("/auth/email", { email: "ada@example.com" })).status).toBe(200);
    expect((await b.post("/auth/email", { email: "ada@example.com" })).status).toBe(429);
    expect(mailer.sent).toHaveLength(EMAIL_LIMIT);
    // Another IP is still limited for that email.
    b.ip = "198.51.100.1";
    expect((await b.post("/auth/email", { email: "ada@example.com" })).status).toBe(429);
    // One IP asking for many addresses.
    const c = new Browser(ctx);
    c.ip = "192.0.2.9";
    let ok = 0;
    for (let i = 0; i < IP_LIMIT + 3; i++) if ((await c.post("/auth/email", { email: `u${i}@example.com` })).status === 200) ok++;
    expect(ok).toBe(IP_LIMIT);
    // The window resets after an hour.
    clock.advance(61 * MINUTE);
    expect((await b.post("/auth/email", { email: "ada@example.com" })).status).toBe(200);
  });

  it("does not build links from a production request's Host header", async () => {
    const { ctx, mailer } = testCtx();
    await new Browser(ctx).post("/auth/email", { email: "ada@example.com" });
    expect(mailer.last()!.text).toContain("https://stackquake.com/auth/email/confirm?token=");
  });
});

describe("sessions and CSRF", () => {
  it("refuses POSTs without a valid CSRF token, signed in or not", async () => {
    const { ctx, mailer } = testCtx();
    const b = new Browser(ctx);
    expect((await b.post("/auth/email", { email: "ada@example.com" }, { csrf: null })).status).toBe(403);
    expect((await b.post("/auth/email", { email: "ada@example.com" }, { csrf: "x".repeat(24) })).status).toBe(403);
    expect(mailer.sent).toHaveLength(0);
    await b.signIn("ada@example.com");
    expect((await b.post("/app/projects", { name: "x" }, { csrf: null })).status).toBe(403);
    // The pre-sign-in token stops working once there is a session.
    expect((await b.post("/app/projects", { name: "x" }, { csrf: b.cookies.get("sq_csrf") ?? "none" })).status).toBe(403);
    expect((await b.post("/app/projects", { name: "x", next: "pick" })).status).toBe(302);
  });

  it("refuses cross-origin form posts", async () => {
    const { ctx } = testCtx();
    const b = new Browser(ctx);
    await b.signIn("ada@example.com");
    const body = new URLSearchParams({ _csrf: await b.csrf(), name: "x" });
    const res = await b.fetch("/app/projects", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("expires sessions after 30 days", async () => {
    const { ctx, clock } = testCtx();
    const b = new Browser(ctx);
    await b.signIn("ada@example.com");
    expect(location(await b.get("/app/settings"))).toBeNull();
    clock.advance(SESSION_MS + 1);
    const res = await b.get("/app/settings");
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/signin?next=%2Fapp%2Fsettings");
  });

  it("stores only a hash of the session token, and signing out ends it", async () => {
    const { ctx } = testCtx();
    const b = new Browser(ctx);
    await b.signIn("ada@example.com");
    const token = b.cookies.get("sq_session")!;
    const [row] = await ctx.db.select().from(sessions).all();
    expect(row.id).toBe(await sha256Hex(token));
    await b.post("/signout");
    expect(await ctx.db.select().from(sessions).all()).toHaveLength(0);
    // Replaying the old cookie does nothing.
    b.cookies.set("sq_session", token);
    expect((await b.get("/app/settings")).status).toBe(302);
  });

  it("only follows same-site paths after sign-in", async () => {
    const { ctx } = testCtx();
    const b = new Browser(ctx);
    await b.post("/auth/email", { email: "ada@example.com", next: "//evil.example/x" });
    const res = await b.post("/auth/email/confirm", { token: lastToken(ctx), next: "https://evil.example" });
    expect(location(res)).toBe("/app");
  });
});

describe("GitHub OAuth (mocked GitHub)", () => {
  const env = testEnv({ GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "secret" });

  function github(http: ReturnType<typeof testCtx>["http"], user: { id: number; login: string; email: string; verified?: boolean }) {
    http.set("https://github.com/login/oauth/access_token", async (req) => {
      const form = await req.formData();
      return Response.json(form.get("code") === "good" && form.get("client_secret") === "secret" ? { access_token: "gho_x", token_type: "bearer" } : { error: "bad_verification_code" });
    });
    http.set("https://api.github.com/user", (req) => (req.headers.get("authorization") === "Bearer gho_x" ? Response.json({ id: user.id, login: user.login, name: null }) : new Response("", { status: 401 })));
    http.set("https://api.github.com/user/emails", () => Response.json([{ email: "1+x@users.noreply.github.com", primary: false, verified: true }, { email: user.email, primary: true, verified: user.verified ?? true }]));
  }

  async function start(b: Browser) {
    const res = await b.get("/auth/github?next=/app/settings");
    expect(res.status).toBe(302);
    const url = new URL(location(res)!);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    return url.searchParams.get("state")!;
  }

  it("creates a user from the verified primary email and returns to `next`", async () => {
    const { ctx, http } = testCtx();
    github(http, { id: 42, login: "ada", email: "Ada@Example.com" });
    const b = new Browser(ctx, env);
    const state = await start(b);
    const res = await b.get(`/auth/github/callback?code=good&state=${state}`);
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/app/settings");
    const u = (await ctx.db.select().from(users).get())!;
    expect(u).toMatchObject({ email: "ada@example.com", githubId: 42, name: "ada" });
  });

  it("links to an existing email account, and finds it again by GitHub id", async () => {
    const { ctx, http } = testCtx();
    const b = new Browser(ctx, env);
    await b.signIn("ada@example.com");
    await b.post("/signout");
    github(http, { id: 42, login: "ada", email: "ada@example.com" });
    await b.get(`/auth/github/callback?code=good&state=${await start(b)}`);
    expect(await ctx.db.select().from(users).all()).toHaveLength(1);
    expect((await ctx.db.select().from(users).get())!.githubId).toBe(42);
    // Email changed on GitHub: the GitHub id still finds the same account.
    github(http, { id: 42, login: "ada", email: "ada@new.example" });
    const c = new Browser(ctx, env);
    await c.get(`/auth/github/callback?code=good&state=${await start(c)}`);
    expect(await ctx.db.select().from(users).all()).toHaveLength(1);
  });

  it("rejects a wrong or missing state, a bad code and unverified emails", async () => {
    const { ctx, http } = testCtx();
    github(http, { id: 7, login: "x", email: "x@example.com", verified: false });
    const b = new Browser(ctx, env);
    await start(b);
    expect((await b.get("/auth/github/callback?code=good&state=forged")).status).toBe(400);
    expect((await b.get(`/auth/github/callback?code=bad&state=${await start(b)}`)).status).toBe(400);
    expect((await b.get(`/auth/github/callback?code=good&state=${await start(b)}`)).status).toBe(400);
    expect(await ctx.db.select().from(users).all()).toHaveLength(0);
  });

  it("is hidden when no OAuth app is configured", async () => {
    const { ctx } = testCtx();
    const b = new Browser(ctx);
    expect(await b.html("/signin")).not.toContain("/auth/github");
    expect((await b.get("/auth/github")).status).toBe(503);
  });
});

describe("email change", () => {
  it("needs the new address confirmed, and refuses one that is taken", async () => {
    const { ctx, mailer } = testCtx();
    const other = new Browser(ctx);
    await other.signIn("taken@example.com");
    const b = new Browser(ctx);
    await b.signIn("ada@example.com");
    await b.post("/app/settings/email", { email: "ada@new.example" });
    expect(mailer.last()!.to).toBe("ada@new.example");
    expect((await b.post("/auth/email/confirm", { token: lastToken(ctx) })).status).toBe(302);
    const me = await ctx.db.select().from(users).where(eq(users.email, "ada@new.example")).get();
    expect(me).toBeDefined();
    await b.post("/app/settings/email", { email: "taken@example.com" });
    expect((await b.post("/auth/email/confirm", { token: lastToken(ctx) })).status).toBe(400);
    expect(await ctx.db.select().from(users).where(eq(users.email, "ada@new.example")).get()).toBeDefined();
  });
});
