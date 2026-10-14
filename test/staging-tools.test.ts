// M5: staging has no cron; the admin drives the scheduler by hand and walks a sample event
// through review, fan-out and delivery.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events, jobs, users } from "../src/db/schema";
import { addDep, mockSes } from "./alert-helpers";
import { FixtureHttp, resetDb } from "./helpers";
import { ADMIN, Browser, location, testEnv, webCtx } from "./web";

beforeEach(resetDb);

describe("staging tools", () => {
  it("are hidden unless STAGING_TOOLS=1", async () => {
    const { ctx } = await webCtx();
    const b = new Browser(ctx);
    await b.signIn(ADMIN);
    expect((await b.get("/admin/staging")).status).toBe(404);
    expect(await b.html("/admin/events")).not.toContain("Staging tools");
  });

  it("sample event → approve → tick → a real alert email", async () => {
    const http = new FixtureHttp();
    const ses = mockSes(http);
    const { ctx } = await webCtx({ http, mailer: ses.mailer, clock: ses.clock });
    await ctx.db.delete(jobs);
    const b = new Browser(ctx, testEnv({ STAGING_TOOLS: "1" }));
    await b.signIn(ADMIN);
    const me = (await ctx.db.select().from(users).where(eq(users.email, ADMIN)).get())!;
    await addDep(ctx, me.id, { catalogId: "cloudflare-workers" }, { tier: "free" });

    expect(await b.html("/admin/staging")).toContain("Run a tick");
    const added = await b.post("/admin/staging/sample-event", { catalog: "cloudflare-workers" });
    expect(location(added)).toMatch(/^\/admin\/events#e\d+$/);
    const e = (await ctx.db.select().from(events).get())!;
    expect(e).toMatchObject({ status: "pending_review", kind: "free_tier", catalogId: "cloudflare-workers" });
    expect(e.title).toContain("[Test]");

    await b.post(`/admin/events/${e.id}/approve`);
    for (let i = 0; i < 4; i++) expect((await b.post("/admin/staging/run", { task: "tick" })).status).toBe(302);
    const alert = ses.sent.find((m) => m.body.subject.includes("[Test] Cloudflare Workers"));
    expect(alert?.body.to).toEqual([ADMIN]);
    expect(alert?.body.text).toContain("Staging test");
  });
});
