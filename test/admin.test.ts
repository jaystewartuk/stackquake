import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { catalogRequests, events } from "../src/db/schema";
import { addSource, resetDb, testCtx } from "./helpers";
import { ADMIN, Browser, location } from "./web";

beforeEach(resetDb);

async function admin(ctx: ReturnType<typeof testCtx>["ctx"]) {
  const b = new Browser(ctx);
  await b.signIn(ADMIN);
  return b;
}

async function pendingEvent(ctx: ReturnType<typeof testCtx>["ctx"], over: Partial<typeof events.$inferInsert> = {}) {
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
  return { row };
}

describe("/admin access", () => {
  it("sends signed-out visitors to sign-in", async () => {
    const res = await new Browser(testCtx().ctx).get("/admin/events");
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/signin?next=%2Fadmin%2Fevents");
  });

  it("is a 404 for signed-in users not in ADMIN_EMAILS", async () => {
    const { ctx } = testCtx();
    const b = new Browser(ctx);
    await b.signIn("someone@example.com");
    expect((await b.get("/admin/events")).status).toBe(404);
    const { row } = await pendingEvent(ctx);
    expect((await b.post(`/admin/events/${row.id}/approve`)).status).toBe(404);
  });

  it("opens for ADMIN_EMAILS, and still needs the CSRF token", async () => {
    const { ctx } = testCtx();
    const { row } = await pendingEvent(ctx);
    const b = await admin(ctx);
    expect((await b.get("/admin/events")).status).toBe(200);
    expect((await b.post(`/admin/events/${row.id}/approve`, {}, { csrf: null })).status).toBe(403);
    expect((await b.post(`/admin/events/${row.id}/approve`, {}, { csrf: "y".repeat(32) })).status).toBe(403);
  });

  it("is off when ADMIN_EMAILS is empty", async () => {
    const { ctx } = testCtx();
    const b = new Browser(ctx, { ...new Browser(ctx).env, ADMIN_EMAILS: "" });
    await b.signIn(ADMIN);
    expect((await b.get("/admin/events")).status).toBe(404);
  });
});

describe("/admin/events", () => {
  it("lists events waiting for review with fetched text escaped", async () => {
    const { ctx } = testCtx();
    const { row } = await pendingEvent(ctx);
    const html = await (await admin(ctx)).html("/admin/events");
    expect(html).toContain(`#${row.id}`);
    expect(html).toContain("Pricing &lt;b&gt;changes&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('href="https://example.com/post"');
  });

  it("does not link non-http source URLs", async () => {
    const { ctx } = testCtx();
    await pendingEvent(ctx, { quoteUrl: "javascript:alert(1)" });
    const html = await (await admin(ctx)).html("/admin/events");
    expect(html).not.toContain('href="javascript:');
  });

  it("approves in one click", async () => {
    const { ctx } = testCtx();
    const { row } = await pendingEvent(ctx);
    expect((await (await admin(ctx)).post(`/admin/events/${row.id}/approve`)).status).toBe(302);
    const e = (await ctx.db.select().from(events).where(eq(events.id, row.id)).get())!;
    expect(e.status).toBe("published");
    expect(e.publishedAt).not.toBeNull();
    expect(e.reviewReason).toBe("approved by admin (was: kind pricing always needs review)");
  });

  it("will not approve an event without a note", async () => {
    const { ctx } = testCtx();
    const { row } = await pendingEvent(ctx, { note: null });
    await (await admin(ctx)).post(`/admin/events/${row.id}/approve`);
    expect((await ctx.db.select().from(events).where(eq(events.id, row.id)).get())!.status).toBe("pending_review");
  });

  it("rejects in one click", async () => {
    const { ctx } = testCtx();
    const { row } = await pendingEvent(ctx);
    await (await admin(ctx)).post(`/admin/events/${row.id}/reject`);
    expect((await ctx.db.select().from(events).where(eq(events.id, row.id)).get())!.status).toBe("rejected");
  });

  it("edits and publishes, re-checking the quote", async () => {
    const { ctx } = testCtx();
    const { row } = await pendingEvent(ctx, { note: null, afterText: "From 1 November, the Pro plan costs $25 per month." });
    const res = await (await admin(ctx)).post(`/admin/events/${row.id}`, { kind: "pricing", title: "Pro plan goes to $25", what_changed: "The Pro plan rises to $25 a month from 1 November.", quote: "the Pro plan costs $25 per month.", effective_date: "2026-11-01" });
    expect(res.status).toBe(302);
    const e = (await ctx.db.select().from(events).where(eq(events.id, row.id)).get())!;
    expect(e).toMatchObject({ status: "published", title: "Pro plan goes to $25", quoteFound: true, effectiveDate: "2026-11-01", reviewReason: "edited and approved by admin" });
    expect((e.note as { what_changed: string }).what_changed).toBe("The Pro plan rises to $25 a month from 1 November.");
  });
});

describe("/admin/requests", () => {
  it("lists picker requests that matched no catalog entry", async () => {
    const { ctx } = testCtx();
    await ctx.db.insert(catalogRequests).values([{ text: "Upstash", createdAt: 1 }, { text: "upstash", createdAt: 2 }, { text: "Hetzner", createdAt: 3 }]);
    const html = await (await admin(ctx)).html("/admin/requests");
    expect(html).toContain("upstash");
    expect(html).toMatch(/upstash<\/strong> <span class="meta">× 2/);
  });
});
