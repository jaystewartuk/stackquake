import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { csrfToken, makeSession } from "../src/admin/auth";
import { events } from "../src/db/schema";
import app from "../src/index";
import { addSource, resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

const TOKEN = "test-admin-token-0123456789";
const ENV = { ...env, ADMIN_TOKEN: TOKEN };

async function session() {
  const cookie = await makeSession(TOKEN, Date.now());
  const csrf = await csrfToken(TOKEN, Number(cookie.split(".")[0]));
  return { cookie: `sq_admin=${cookie}`, csrf };
}

const req = (path: string, init: RequestInit = {}, e: object = ENV) => app.fetch(new Request(`https://stackquake.test${path}`, init), e as never, { waitUntil() {}, passThroughOnException() {} } as never);

function post(path: string, fields: Record<string, string>, cookie?: string) {
  return req(path, { method: "POST", body: new URLSearchParams(fields), headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, redirect: "manual" });
}

async function pendingEvent(over: Partial<typeof events.$inferInsert> = {}) {
  const { ctx } = testCtx();
  const source = await addSource(ctx, { kind: "feed", key: "https://example.com/feed", url: "https://example.com/feed" });
  const [row] = await ctx.db
    .insert(events)
    .values({
      sourceId: source.id,
      catalogId: "deno",
      kind: "pricing",
      detectedAt: Date.now(),
      status: "pending_review",
      title: "Pricing <b>changes</b>",
      quote: "Prices go up <script>alert(1)</script>",
      quoteFound: true,
      quoteUrl: "https://example.com/post",
      afterText: "<img src=x onerror=alert(1)>",
      dedupeKey: `k${Math.random()}`,
      reviewReason: "kind pricing always needs review",
      note: { material: true, kind: "pricing", title: "t", what_changed: "Prices go up.", quote: "q", effective_date: null, applies_when: { hosting: [], use: [], tier: [] }, who_is_not_affected: null, options: [], uncertain: [], confidence: 0.9 },
      ...over,
    })
    .returning();
  return { ctx, row };
}

describe("/admin auth", () => {
  it("is off without ADMIN_TOKEN", async () => {
    expect((await req("/admin/events", {}, { ...env })).status).toBe(503);
  });

  it("redirects to the login form without a session", async () => {
    const res = await req("/admin/events", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
  });

  it("rejects a wrong token and sets a strict, HttpOnly, Secure cookie for the right one", async () => {
    expect((await post("/admin/login", { token: "nope" })).status).toBe(401);
    const res = await post("/admin/login", { token: TOKEN });
    expect(res.status).toBe(302);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^sq_admin=\d+\.[\w-]+;/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/admin");
  });

  it("rejects a forged or expired session", async () => {
    const forged = await req("/admin/events", { headers: { cookie: `sq_admin=${Date.now() + 1e9}.AAAA` }, redirect: "manual" });
    expect(forged.status).toBe(302);
    const old = await makeSession(TOKEN, Date.now() - 8 * 24 * 3_600_000);
    expect((await req("/admin/events", { headers: { cookie: `sq_admin=${old}` }, redirect: "manual" })).status).toBe(302);
  });

  it("refuses POSTs without the CSRF token", async () => {
    const { row } = await pendingEvent();
    const { cookie } = await session();
    expect((await post(`/admin/events/${row.id}/approve`, {}, cookie)).status).toBe(403);
    expect((await post(`/admin/events/${row.id}/approve`, { _csrf: "x" }, cookie)).status).toBe(403);
  });
});

describe("/admin/events", () => {
  it("lists events waiting for review with fetched text escaped", async () => {
    const { row } = await pendingEvent();
    const { cookie } = await session();
    const html = await (await req("/admin/events", { headers: { cookie } })).text();
    expect(html).toContain(`#${row.id}`);
    expect(html).toContain("Pricing &lt;b&gt;changes&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('href="https://example.com/post"');
  });

  it("does not link non-http source URLs", async () => {
    await pendingEvent({ quoteUrl: "javascript:alert(1)" });
    const { cookie } = await session();
    const html = await (await req("/admin/events", { headers: { cookie } })).text();
    expect(html).not.toContain('href="javascript:');
  });

  it("approves in one click", async () => {
    const { ctx, row } = await pendingEvent();
    const { cookie, csrf } = await session();
    expect((await post(`/admin/events/${row.id}/approve`, { _csrf: csrf }, cookie)).status).toBe(302);
    const e = (await ctx.db.select().from(events).where(eq(events.id, row.id)).get())!;
    expect(e.status).toBe("published");
    expect(e.publishedAt).not.toBeNull();
    expect(e.reviewReason).toBe("approved by admin (was: kind pricing always needs review)");
  });

  it("will not approve an event without a note", async () => {
    const { ctx, row } = await pendingEvent({ note: null });
    const { cookie, csrf } = await session();
    await post(`/admin/events/${row.id}/approve`, { _csrf: csrf }, cookie);
    expect((await ctx.db.select().from(events).where(eq(events.id, row.id)).get())!.status).toBe("pending_review");
  });

  it("rejects in one click", async () => {
    const { ctx, row } = await pendingEvent();
    const { cookie, csrf } = await session();
    await post(`/admin/events/${row.id}/reject`, { _csrf: csrf }, cookie);
    expect((await ctx.db.select().from(events).where(eq(events.id, row.id)).get())!.status).toBe("rejected");
  });

  it("edits and publishes, re-checking the quote", async () => {
    const { ctx, row } = await pendingEvent({ note: null, afterText: "From 1 November, the Pro plan costs $25 per month." });
    const { cookie, csrf } = await session();
    const res = await post(`/admin/events/${row.id}`, { _csrf: csrf, kind: "pricing", title: "Pro plan goes to $25", what_changed: "The Pro plan rises to $25 a month from 1 November.", quote: "the Pro plan costs $25 per month.", effective_date: "2026-11-01" }, cookie);
    expect(res.status).toBe(302);
    const e = (await ctx.db.select().from(events).where(eq(events.id, row.id)).get())!;
    expect(e).toMatchObject({ status: "published", title: "Pro plan goes to $25", quoteFound: true, effectiveDate: "2026-11-01", reviewReason: "edited and approved by admin" });
    expect((e.note as { what_changed: string }).what_changed).toBe("The Pro plan rises to $25 a month from 1 November.");
  });
});
