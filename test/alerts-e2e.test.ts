// SPEC §11 E2, E3 and E4, end to end in Miniflare with the LLM and Resend mocked. Users sign in
// and build their stacks through the web app; the watcher, pipeline, fan-out and delivery run as
// cron ticks.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog/entries";
import { alerts, deps, events, jobs, llmCalls, type Event } from "../src/db/schema";
import { runDaily } from "../src/jobs/cron";
import { runTick } from "../src/jobs/runner";
import { json } from "../src/llm/fake";
import { npmUrl } from "../src/sources/kinds/npm";
import { HOUR } from "../src/util";
import { recordEvent } from "../src/watch/events";
import { getSource, pollSource } from "../src/watch/poll";
import { mockResend, note, settle, sourceId } from "./alert-helpers";
import { FixtureHttp, resetDb } from "./helpers";
import { ADMIN, Browser, location, webCtx } from "./web";

beforeEach(resetDb);

async function setup() {
  const http = new FixtureHttp();
  const resend = mockResend(http);
  const t = await webCtx({ http, mailer: resend.mailer });
  await t.ctx.db.delete(jobs);
  return { ...t, resend };
}
type T = Awaited<ReturnType<typeof setup>>;

/** Signs in, creates a project with Redis from the picker and answers "how do you run it?". */
async function userWithRedis(t: T, email: string, hosting: "hosted" | "self_hosted") {
  const b = new Browser(t.ctx);
  await b.signIn(email);
  const created = await b.post("/app/projects", { name: "Shop", next: "pick" });
  const projectId = Number(/\/app\/projects\/(\d+)\/services/.exec(location(created)!)![1]);
  await b.post(`/app/projects/${projectId}/services`, { ids: "redis", shown: "redis" });
  const dep = (await t.ctx.db.select().from(deps).where(eq(deps.projectId, projectId)).get())!;
  expect((await b.post(`/app/projects/${projectId}/profiles`, { [`d${dep.id}_hosting`]: hosting })).status).toBe(302);
  return { b, dep };
}

const redisLatest = (license: string, version: string) => ({ name: "redis", version, license, repository: { type: "git", url: "git+https://github.com/redis/node-redis.git" } });

/** The npm registry flips the redis package's licence; returns the event the watcher records. */
async function licenceChange(t: T): Promise<Event> {
  const src = await sourceId(t.ctx, "npm", "redis");
  t.http.set(npmUrl("redis"), redisLatest("MIT", "5.0.0"));
  await pollSource(t.ctx, (await getSource(t.ctx, src))!);
  t.http.set(npmUrl("redis"), redisLatest("SSPL-1.0", "6.0.0"));
  const report = await pollSource(t.ctx, (await getSource(t.ctx, src))!);
  expect(report).toMatchObject({ status: "changed", eventsCreated: 1 });
  return (await t.ctx.db.select().from(events).where(eq(events.sourceId, src)).get())!;
}

const SELF_HOSTED_ONLY = { hosting: ["self_hosted" as const], use: [], tier: [] };
const getAlerts = (t: T) => t.ctx.db.select().from(alerts).all();

describe("E2: a source change becomes an email for an affected user and a suppressed alert for an unaffected one", () => {
  it("runs end to end", async () => {
    const t = await setup();
    const alice = await userWithRedis(t, "alice@example.com", "self_hosted");
    const bob = await userWithRedis(t, "bob@example.com", "hosted");
    const signInMails = t.resend.sent.length;
    t.llm.on("summarise", json(note({ title: "Redis client licence moves to SSPL", applies_when: SELF_HOSTED_ONLY, who_is_not_affected: "People using Redis Cloud." })));

    const raw = await licenceChange(t);
    expect(raw.status).toBe("pending_llm");
    await settle(t);

    const e = (await t.ctx.db.select().from(events).where(eq(events.id, raw.id)).get())!;
    expect(e).toMatchObject({ status: "published", kind: "license", quoteFound: true });

    // One email, to Alice only.
    const mails = t.resend.sent.slice(signInMails);
    expect(mails).toHaveLength(1);
    const m = mails[0].body;
    expect(m.to).toEqual(["alice@example.com"]);
    expect(m.from).toBe("Stackquake <alerts@stackquake.com>");
    expect(m.subject).toBe("[Stackquake] Redis: Redis client licence moves to SSPL");
    expect(m.text).toContain('> "license": "SSPL-1.0"');
    expect(m.text).toContain("Affects you because: you use Redis self-hosted in Shop, which the change applies to.");
    expect(m.text).toContain("Not affected: People using Redis Cloud.");
    expect(m.text).toContain("- Valkey (low effort): BSD-licensed fork");
    expect(m.text).toContain("Summary, not legal advice; read the source.");
    expect(m.html).toContain("<blockquote");
    expect(m.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/stackquake\.test\/a\/d\d+\./);
    expect(mails[0].key).toMatch(/^alert-\d+$/);

    const list = await getAlerts(t);
    expect(list).toHaveLength(2);
    expect(list.find((a) => a.depId === alice.dep.id)).toMatchObject({ status: "sent", channel: "email", match: "affected" });
    expect(list.find((a) => a.depId === bob.dep.id)).toMatchObject({ status: "suppressed", match: "not_affected", sentAt: null });

    // Alice says it was not relevant, through the link in the email.
    const link = /Not relevant: https:\/\/stackquake\.test(\/a\/\S+)/.exec(m.text)![1];
    const confirm = await alice.b.html(link);
    expect(confirm).toContain("Mark this alert as not relevant?");
    expect((await getAlerts(t)).find((a) => a.depId === alice.dep.id)!.feedback).toBeNull();
    await alice.b.post(link);
    expect((await getAlerts(t)).find((a) => a.depId === alice.dep.id)!.feedback).toBe("not_relevant");

    // Dashboards: Alice sees the sent alert, Bob a change that didn't affect him.
    const aliceDash = await alice.b.html("/app");
    expect(aliceDash).toContain("Redis client licence moves to SSPL");
    expect(aliceDash).toMatch(/Sent 2026-10-10 by email/);
    const bobDash = await bob.b.html("/app");
    expect(bobDash).toContain("1 change we watched that didn&#39;t affect you");
    expect(bobDash).toContain("It only applies to use self-hosted, and you use Redis hosted in Shop.");
  });
});

describe("E3: a note whose quote is not in the source stays in review and sends nothing", () => {
  it("holds it, then delivers once an admin approves it", async () => {
    const t = await setup();
    await userWithRedis(t, "alice@example.com", "self_hosted");
    const before = t.resend.sent.length;
    t.llm.on("summarise", json(note({ quote: "Redis is now closed source for everyone.", applies_when: SELF_HOSTED_ONLY })));
    const raw = await licenceChange(t);
    await settle(t);

    const e = (await t.ctx.db.select().from(events).where(eq(events.id, raw.id)).get())!;
    expect(e).toMatchObject({ status: "pending_review", quoteFound: false, reviewReason: expect.stringContaining("quote not found") });
    expect(await getAlerts(t)).toHaveLength(0);
    expect(await t.ctx.db.select().from(jobs).where(eq(jobs.kind, "fanout")).all()).toHaveLength(0);
    expect(t.resend.sent.length).toBe(before);

    // A person's approval publishes it and fans it out.
    const admin = new Browser(t.ctx);
    await admin.signIn(ADMIN);
    expect((await admin.post(`/admin/events/${e.id}/approve`)).status).toBe(302);
    await settle(t);
    expect(t.resend.sent.slice(before + 1).map((m) => m.body.to[0])).toEqual(["alice@example.com"]);
  });
});

describe("E4: with the weekly LLM budget exceeded, classify pauses and the admin is emailed", () => {
  async function spend(t: T, usd: number) {
    await t.ctx.db.insert(llmCalls).values({ purpose: "summarise", model: "claude-opus-5-5", inputTokens: 1, outputTokens: 1, costUsd: usd, outcome: "ok", createdAt: t.clock.now() - 2 * HOUR });
  }
  async function feedItem(t: T) {
    const feed = await sourceId(t.ctx, "feed", "https://deno.com/feed");
    // Long enough that fetch_post keeps the feed text, so the next step is classify.
    return recordEvent(t.ctx, { sourceId: feed, sourceKind: "feed", catalogId: "deno", change: { kind: "other", title: "Deno is joining Cloudflare", dedupeTitle: "feed item x", quoteUrl: "https://deno.com/blog/x", afterText: "Deno news. ".repeat(300) } });
  }
  const runPipeline = async (t: T) => {
    for (let i = 0; i < 4; i++) {
      await t.ctx.db.delete(jobs).where(eq(jobs.kind, "poll"));
      await runTick(t.ctx);
    }
  };

  it("above twice the budget: admin email, classify deferred, summarise still runs", async () => {
    const t = await setup();
    await spend(t, 25); // budget $10
    t.llm.defaults = { summarise: json(note()) };
    await runDaily(t.ctx, CATALOG);
    const budgetMail = t.resend.sent.find((m) => m.body.subject.includes("LLM spend"))!;
    expect(budgetMail.body.to).toEqual([ADMIN]);
    expect(budgetMail.body.subject).toBe("[Stackquake] LLM spend $25.00 in 7 days (budget $10.00)");
    expect(budgetMail.body.text).toContain("classify steps are paused");

    const { id } = await feedItem(t);
    await runPipeline(t);
    const e = (await t.ctx.db.select().from(events).where(eq(events.id, id)).get())!;
    expect(e.status).toBe("pending_llm");
    expect(t.llm.calls("classify")).toHaveLength(0);
    const job = (await t.ctx.db.select().from(jobs).where(eq(jobs.eventId, id)).get())!;
    expect(job).toMatchObject({ kind: "classify", parkedAt: null, lastError: null, attempts: 0 });
    expect(job.runAfter).toBeGreaterThan(t.clock.now() + 5 * HOUR);

    // Summarise is not paused: a registry change still gets its note and is published.
    const raw = await licenceChange(t);
    await runPipeline(t);
    expect((await t.ctx.db.select().from(events).where(eq(events.id, raw.id)).get())!.status).toBe("published");

    // The admin page says so.
    const admin = new Browser(t.ctx);
    await admin.signIn(ADMIN);
    expect(await admin.html("/admin/events")).toContain("classify paused");

    // Once the spend rolls out of the 7-day window, classification resumes.
    t.clock.advance(7 * 24 * HOUR);
    t.llm.on("classify", json({ kind: "other", confidence: 0.95, effective_date: null, one_line: "News.", quote: "" }));
    await runPipeline(t);
    expect(t.llm.calls("classify")).toHaveLength(1);
  });

  it("between the budget and twice it: the admin is emailed, classify keeps running", async () => {
    const t = await setup();
    await spend(t, 15);
    await runDaily(t.ctx, CATALOG);
    expect(t.resend.sent.filter((m) => m.body.subject.includes("LLM spend"))).toHaveLength(1);
    t.llm.on("classify", json({ kind: "other", confidence: 0.95, effective_date: null, one_line: "News.", quote: "" }));
    await feedItem(t);
    await runPipeline(t);
    expect(t.llm.calls("classify")).toHaveLength(1);
  });

  it("under budget: no email", async () => {
    const t = await setup();
    await spend(t, 9);
    await runDaily(t.ctx, CATALOG);
    expect(t.resend.sent).toHaveLength(0);
  });
});
