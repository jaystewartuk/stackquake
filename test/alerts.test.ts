// M4 alerts against D1: fan-out, rate limit, mute, delivery idempotence, Slack, digest.
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { deliverStep } from "../src/alerts/deliver";
import { enqueueDigests } from "../src/alerts/digest";
import { FANOUT_CHUNK, fanoutStep } from "../src/alerts/fanout";
import { encrypt } from "../src/alerts/secretbox";
import type { Ctx } from "../src/context";
import { alerts, channels, deps, events, jobs, users, type Alert, type Job } from "../src/db/schema";
import { DAY, HOUR } from "../src/util";
import { addDep, addUser, mockResend, note, publish, settle, sourceId } from "./alert-helpers";
import { FixtureHttp, resetDb, TEST_CHANNEL_KEY } from "./helpers";
import { webCtx } from "./web";

beforeEach(resetDb);

const allAlerts = (t: { ctx: Ctx }): Promise<Alert[]> => t.ctx.db.select().from(alerts).all();

async function setup() {
  const http = new FixtureHttp();
  const resend = mockResend(http);
  const t = await webCtx({ http, mailer: resend.mailer });
  await t.ctx.db.delete(jobs);
  return { ...t, resend };
}

const redisNpm = (t: Awaited<ReturnType<typeof setup>>) => sourceId(t.ctx, "npm", "redis");

describe("fan-out", () => {
  it("affected and unknown get alerts, not_affected a suppressed one; immediate ones are emailed", async () => {
    const t = await setup();
    const selfHosted = await addUser(t.ctx, "self@example.com");
    const hosted = await addUser(t.ctx, "hosted@example.com");
    const unsure = await addUser(t.ctx, "unsure@example.com");
    await addDep(t.ctx, selfHosted.id, { catalogId: "redis" }, { hosting: "self_hosted" });
    await addDep(t.ctx, hosted.id, { catalogId: "redis" }, {}, { hosting: "hosted" }); // from the project default
    await addDep(t.ctx, unsure.id, { catalogId: "redis" });
    await publish(t.ctx, await redisNpm(t), { note: note({ applies_when: { hosting: ["self_hosted"], use: [], tier: [] } }) });
    await settle(t);

    const byUser = new Map((await allAlerts(t)).map((a) => [a.userId, a]));
    expect(byUser.get(selfHosted.id)).toMatchObject({ match: "affected", status: "sent", channel: "email", because: expect.stringContaining("self-hosted") });
    expect(byUser.get(unsure.id)).toMatchObject({ match: "unknown", status: "sent", because: "We don't know how you use Redis, so we assume it does." });
    expect(byUser.get(hosted.id)).toMatchObject({ match: "not_affected", status: "suppressed", channel: "digest", emailedAt: null });
    expect(t.resend.sent.map((m) => m.body.to[0]).sort()).toEqual(["self@example.com", "unsure@example.com"]);
  });

  it("makes one alert per user, from the dep that matches best", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "two@example.com");
    await addDep(t.ctx, u.id, { catalogId: "redis" }, { hosting: "hosted" });
    const selfHosted = await addDep(t.ctx, u.id, { catalogId: "redis" }, { hosting: "self_hosted" });
    await publish(t.ctx, await redisNpm(t), { note: note({ applies_when: { hosting: ["self_hosted"], use: [], tier: [] } }) });
    await settle(t);
    const list = await allAlerts(t);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ depId: selfHosted.id, match: "affected" });
    expect(t.resend.sent).toHaveLength(1);
  });

  it("sends nothing about a muted dependency, and alerts again once the mute ends", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "mute@example.com");
    const d = await addDep(t.ctx, u.id, { catalogId: "redis" });
    await t.ctx.db.update(deps).set({ mutedUntil: t.clock.now() + 90 * DAY }).where(eq(deps.id, d.id));
    const src = await redisNpm(t);
    await publish(t.ctx, src);
    await settle(t);
    expect(await allAlerts(t)).toHaveLength(0);
    expect(t.resend.sent).toHaveLength(0);

    t.clock.advance(91 * DAY);
    await publish(t.ctx, src, { title: "Another licence change" });
    await settle(t);
    expect(await allAlerts(t)).toHaveLength(1);
    expect(t.resend.sent).toHaveLength(1);
  });

  it("holds non-urgent changes for the digest, and urgent ones for users who chose digest only", async () => {
    const t = await setup();
    const a = await addUser(t.ctx, "a@example.com");
    const b = await addUser(t.ctx, "b@example.com", { emailImmediate: false });
    await addDep(t.ctx, a.id, { catalogId: "redis" });
    await addDep(t.ctx, b.id, { catalogId: "redis" });
    const src = await redisNpm(t);
    const pricing = await publish(t.ctx, src, { note: note({ kind: "pricing", title: "Redis Cloud prices up 10%" }) });
    const licence = await publish(t.ctx, src, { title: "Licence moves to SSPL" });
    await settle(t);
    const get = async (user: number, event: number) => (await allAlerts(t)).find((x) => x.userId === user && x.eventId === event)!;
    expect(await get(a.id, pricing.id)).toMatchObject({ channel: "digest", status: "queued", held: "not_urgent" });
    expect(await get(b.id, pricing.id)).toMatchObject({ channel: "digest", status: "queued", held: "not_urgent" });
    expect(await get(a.id, licence.id)).toMatchObject({ channel: "email", status: "sent" });
    expect(await get(b.id, licence.id)).toMatchObject({ channel: "digest", status: "queued", held: "digest_only" });
    expect(t.resend.sent.map((m) => m.body.to[0])).toEqual(["a@example.com"]);
  });

  it("for a feed several entries share, only matches entries whose keywords appear in the event", async () => {
    const t = await setup();
    const r2 = await addUser(t.ctx, "r2@example.com");
    const d1 = await addUser(t.ctx, "d1@example.com");
    const workers = await addUser(t.ctx, "workers@example.com");
    await addDep(t.ctx, r2.id, { catalogId: "cloudflare-r2" });
    await addDep(t.ctx, d1.id, { catalogId: "cloudflare-d1" });
    await addDep(t.ctx, workers.id, { catalogId: "cloudflare-workers" });
    const blog = await sourceId(t.ctx, "feed", "https://blog.cloudflare.com/rss/");
    await publish(t.ctx, blog, { catalogId: null, note: note({ kind: "pricing", title: "R2 egress is no longer free", what_changed: "R2 starts charging for egress." }) });
    await settle(t);
    expect((await allAlerts(t)).map((a) => a.userId).sort()).toEqual([r2.id, workers.id].sort());
  });

  it("is chunked: an event touching more deps than one step handles fans out over several steps", async () => {
    const t = await setup();
    const n = FANOUT_CHUNK * 2 + 50;
    const now = t.clock.now();
    const src = await redisNpm(t);
    // n users, each with a project and a Redis dep linked to the npm source.
    await t.ctx.db.run(sql`WITH RECURSIVE i(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM i WHERE x < ${n})
      INSERT INTO users (id, email, created_at) SELECT 1000 + x, 'bulk' || x || '@example.com', ${now} FROM i`);
    await t.ctx.db.run(sql`INSERT INTO projects (id, user_id, name, default_profile, created_at) SELECT id, id, 'p', '{}', ${now} FROM users WHERE id >= 1000`);
    await t.ctx.db.run(sql`INSERT INTO deps (id, project_id, catalog_id, profile, origin, dep_key, created_at) SELECT id, id, 'redis', '{}', 'manual', 'catalog:redis', ${now} FROM projects WHERE id >= 1000`);
    await t.ctx.db.run(sql`INSERT INTO dep_sources (dep_id, source_id) SELECT id, ${src} FROM deps WHERE id >= 1000`);
    const e = await publish(t.ctx, src, { kind: "pricing", note: note({ kind: "pricing" }) });

    const steps: string[] = [];
    for (let i = 0; i < 10; i++) {
      const job = await t.ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `fanout:${e.id}`)).get();
      if (!job) break;
      const r = await fanoutStep(t.ctx, job);
      steps.push(r.type);
      if (r.type === "done") await t.ctx.db.delete(jobs).where(eq(jobs.id, job.id));
    }
    expect(steps).toEqual(["reschedule", "reschedule", "done"]);
    const [{ c }] = await t.ctx.db.all<{ c: number }>(sql`SELECT count(*) AS c FROM alerts WHERE event_id = ${e.id}`);
    expect(c).toBe(n);
  });
});

describe("idempotence", () => {
  it("fan-out and delivery each run twice: one alert, one email", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "twice@example.com");
    await addDep(t.ctx, u.id, { catalogId: "redis" });
    const e = await publish(t.ctx, await redisNpm(t));
    const fanoutJob = (await t.ctx.db.select().from(jobs).where(eq(jobs.kind, "fanout")).get())!;
    await fanoutStep(t.ctx, fanoutJob);
    await fanoutStep(t.ctx, fanoutJob);
    expect(await allAlerts(t)).toHaveLength(1);
    const deliver = await t.ctx.db.select().from(jobs).where(eq(jobs.kind, "deliver")).all();
    expect(deliver).toHaveLength(1);
    await deliverStep(t.ctx, deliver[0]);
    await deliverStep(t.ctx, deliver[0]);
    expect(t.resend.sent).toHaveLength(1);
    expect(t.resend.requests).toBe(1);
    expect(t.resend.sent[0].key).toBe(`alert-${(await allAlerts(t))[0].id}`);
    expect(e.id).toBeGreaterThan(0);
  });

  it("a send whose result was lost is retried with the same Idempotency-Key, so Resend sends it once", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "lost@example.com");
    await addDep(t.ctx, u.id, { catalogId: "redis" });
    await publish(t.ctx, await redisNpm(t));
    await settle(t);
    const [a] = await allAlerts(t);
    // As if the invocation died after Resend accepted the email but before emailed_at was written.
    await t.ctx.db.update(alerts).set({ status: "queued", emailedAt: null, sentAt: null }).where(eq(alerts.id, a.id));
    await deliverStep(t.ctx, { payload: { alertId: a.id } } as unknown as Job);
    expect(t.resend.requests).toBe(2);
    expect(t.resend.sent).toHaveLength(1);
    expect((await allAlerts(t))[0]).toMatchObject({ status: "sent" });
  });

  it("a temporary Resend failure is retried; a permanent one marks the alert failed", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "flaky@example.com");
    await addDep(t.ctx, u.id, { catalogId: "redis" });
    const src = await redisNpm(t);
    await publish(t.ctx, src);
    t.resend.failWith(500);
    await settle(t);
    expect(t.resend.sent).toHaveLength(1);
    expect((await allAlerts(t))[0]).toMatchObject({ status: "sent" });

    await publish(t.ctx, src, { title: "Second licence change" });
    t.resend.failWith(422);
    await settle(t);
    const second = (await allAlerts(t)).find((a) => a.status !== "sent")!;
    expect(second).toMatchObject({ status: "failed", error: expect.stringContaining("resend 422") });
  });
});

describe("rate limit (SPEC §7.5)", () => {
  it("the 4th immediate alert in a day goes to the digest; the next day's goes out", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "busy@example.com");
    for (const id of ["redis", "stripe", "vercel", "sentry"]) await addDep(t.ctx, u.id, { catalogId: id });
    const npm = ["redis", "stripe", "vercel", "@sentry/node"];
    for (const pkg of npm) {
      await publish(t.ctx, await sourceId(t.ctx, "npm", pkg), { title: `${pkg}: licence change` });
      t.clock.advance(HOUR);
    }
    await settle(t);
    const list = (await allAlerts(t)).sort((a, b) => a.id - b.id);
    expect(list.map((a) => [a.channel, a.status, a.held])).toEqual([
      ["email", "sent", null],
      ["email", "sent", null],
      ["email", "sent", null],
      ["digest", "queued", "rate_limit"],
    ]);
    expect(t.resend.sent).toHaveLength(3);

    t.clock.advance(DAY);
    await publish(t.ctx, await sourceId(t.ctx, "npm", "redis"), { title: "redis: another licence change" });
    await settle(t);
    expect(t.resend.sent).toHaveLength(4);
  });
});

describe("Slack delivery", () => {
  const HOOK = "https://hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx";

  async function withSlack(status = 200) {
    const t = await setup();
    const posts: unknown[] = [];
    let answer = status;
    t.http.set(HOOK, async (req) => {
      posts.push(await req.json());
      return new Response(answer === 200 ? "ok" : "no_service", { status: answer });
    });
    const u = await addUser(t.ctx, "slack@example.com");
    await t.ctx.db.insert(channels).values({ userId: u.id, kind: "slack", webhookUrlEnc: await encrypt(TEST_CHANNEL_KEY, HOOK), verifiedAt: t.clock.now(), hint: "uvwx", createdAt: t.clock.now() });
    await addDep(t.ctx, u.id, { catalogId: "redis" });
    return { ...t, u, posts, answer: (s: number) => (answer = s) };
  }

  it("posts Block Kit to the webhook as well as the email", async () => {
    const t = await withSlack();
    await publish(t.ctx, await redisNpm(t));
    await settle(t);
    expect(t.resend.sent).toHaveLength(1);
    expect(t.posts).toHaveLength(1);
    const msg = t.posts[0] as { text: string; blocks: { type: string }[] };
    expect(msg.text).toBe("Redis: Licence moves to SSPL");
    expect(msg.blocks[0].type).toBe("header");
    expect(JSON.stringify(msg.blocks)).toContain("Summary, not legal advice");
    expect((await allAlerts(t))[0]).toMatchObject({ status: "sent", emailedAt: expect.any(Number), slackAt: expect.any(Number) });
  });

  it("a Slack 500 is retried without emailing again; a 404 is recorded and not retried", async () => {
    const t = await withSlack(500);
    const src = await redisNpm(t);
    await publish(t.ctx, src);
    // Fan-out, then delivery: email sent, Slack fails and the step waits for its retry.
    await settle(t, 2, 0, false);
    expect(t.resend.sent).toHaveLength(1);
    expect((await allAlerts(t))[0]).toMatchObject({ status: "queued", emailedAt: expect.any(Number), slackAt: null, slackTryAt: null });
    t.answer(200);
    await settle(t);
    expect(t.resend.sent).toHaveLength(1);
    expect(t.posts).toHaveLength(2);
    expect((await allAlerts(t))[0]).toMatchObject({ status: "sent", slackAt: expect.any(Number) });

    t.answer(404);
    await publish(t.ctx, src, { title: "Second change" });
    await settle(t);
    const second = (await allAlerts(t)).find((a) => a.slackAt === null)!;
    expect(second).toMatchObject({ status: "sent", error: expect.stringContaining("slack 404") });
    expect(t.posts).toHaveLength(3);
    expect((await t.ctx.db.select().from(channels).get())!.lastError).toContain("404");
  }, 20_000);

  it("a Slack post that started but never recorded a result is not repeated", async () => {
    const t = await withSlack();
    await publish(t.ctx, await redisNpm(t));
    await settle(t);
    const [a] = await allAlerts(t);
    await t.ctx.db.update(alerts).set({ status: "queued", slackAt: null }).where(eq(alerts.id, a.id));
    await deliverStep(t.ctx, { payload: { alertId: a.id } } as unknown as Job);
    expect(t.posts).toHaveLength(1);
  });
});

describe("weekly digest", () => {
  // The fake clock starts on Saturday 2026-10-10 (UTC day 6).
  const SATURDAY = 6;

  async function digestUser(t: Awaited<ReturnType<typeof setup>>, over = {}) {
    const u = await addUser(t.ctx, "digest@example.com", { digestDay: SATURDAY, ...over });
    await addDep(t.ctx, u.id, { catalogId: "redis" }, { hosting: "hosted" });
    return u;
  }
  const runDigest = async (t: Awaited<ReturnType<typeof setup>>) => {
    await enqueueDigests(t.ctx);
    await settle(t);
  };

  it("carries held alerts and the count of changes that don't affect the user, once", async () => {
    const t = await setup();
    const u = await digestUser(t);
    const src = await redisNpm(t);
    await publish(t.ctx, src, { note: note({ kind: "pricing", title: "Redis Cloud prices up" }) });
    await publish(t.ctx, src, { title: "Self-hosted licence change", note: note({ title: "Self-hosted licence change", applies_when: { hosting: ["self_hosted"], use: [], tier: [] } }) });
    await settle(t);
    expect(t.resend.sent).toHaveLength(0);

    await runDigest(t);
    expect(t.resend.sent).toHaveLength(1);
    const m = t.resend.sent[0].body;
    expect(m.subject).toBe("[Stackquake] Weekly digest: 1 change that affects you");
    expect(m.text).toContain("Redis: Redis Cloud prices up");
    expect(m.text).toContain("1 change we watched that doesn't affect you:");
    expect(m.text).toContain("Redis: Self-hosted licence change");
    expect(m.html).toContain("Weekly digest");
    expect((await allAlerts(t)).map((a) => [a.status, a.digestAt !== null])).toEqual(expect.arrayContaining([["sent", true], ["suppressed", true]]));
    expect((await t.ctx.db.select().from(users).where(eq(users.id, u.id)).get())!.lastDigestAt).toBe(t.clock.now());

    // The daily run again on the same day: nothing more.
    await runDigest(t);
    expect(t.resend.sent).toHaveLength(1);
  });

  it("sends 'all quiet' for the first digest of the month, then skips quiet weeks and carries suppressed changes", async () => {
    const t = await setup();
    await digestUser(t);
    await runDigest(t);
    expect(t.resend.sent.map((m) => m.body.subject)).toEqual(["[Stackquake] Weekly digest: all quiet"]);

    // A week later (still October): only a change that doesn't affect them. No digest.
    t.clock.advance(7 * DAY);
    await publish(t.ctx, await redisNpm(t), { note: note({ applies_when: { hosting: ["self_hosted"], use: [], tier: [] } }) });
    await settle(t);
    await runDigest(t);
    expect(t.resend.sent).toHaveLength(1);
    expect((await allAlerts(t))[0]).toMatchObject({ status: "suppressed", digestAt: null });

    // Next month's first digest goes out and mentions it.
    t.clock.advance(28 * DAY); // Saturday 2026-11-14
    await runDigest(t);
    expect(t.resend.sent).toHaveLength(2);
    expect(t.resend.sent[1].body.text).toContain("1 change we watched that doesn't affect you");
  });

  it("is idempotent: a retried digest renders the same set and reuses its key", async () => {
    const t = await setup();
    const u = await digestUser(t);
    await publish(t.ctx, await redisNpm(t), { note: note({ kind: "pricing" }) });
    await settle(t);
    await enqueueDigests(t.ctx);
    await settle(t);
    // As if the invocation died after sending, before marking the user.
    await t.ctx.db.update(users).set({ lastDigestAt: null }).where(eq(users.id, u.id));
    await t.ctx.db.update(alerts).set({ status: "queued", sentAt: null });
    await publish(t.ctx, await redisNpm(t), { title: "A newer change", note: note({ kind: "pricing", title: "A newer change" }) });
    await settle(t);
    await enqueueDigests(t.ctx);
    await settle(t);
    expect(t.resend.requests).toBe(2);
    expect(t.resend.sent).toHaveLength(1);
    expect(t.resend.sent[0].key).toBe(`digest-${u.id}-2026-10-10`);
    // The newer change was not swept into the already-sent digest; it waits for the next one.
    const newer = (await allAlerts(t)).find((a) => a.digestAt === null)!;
    expect(newer).toMatchObject({ status: "queued", channel: "digest" });
  });

  it("only users whose digest day is today", async () => {
    const t = await setup();
    await addUser(t.ctx, "today@example.com", { digestDay: SATURDAY });
    await addUser(t.ctx, "monday@example.com", { digestDay: 1 });
    await enqueueDigests(t.ctx);
    expect((await t.ctx.db.select().from(jobs).where(eq(jobs.kind, "digest")).all()).map((j) => j.dedupeKey)).toHaveLength(1);
  });
});

describe("withdrawn events", () => {
  it("an event rejected after publishing is not delivered", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "w@example.com");
    await addDep(t.ctx, u.id, { catalogId: "redis" });
    const e = await publish(t.ctx, await redisNpm(t));
    const fanout = (await t.ctx.db.select().from(jobs).where(eq(jobs.kind, "fanout")).get())!;
    await fanoutStep(t.ctx, fanout);
    await t.ctx.db.update(events).set({ status: "rejected" }).where(eq(events.id, e.id));
    await settle(t);
    expect(t.resend.sent).toHaveLength(0);
    expect((await allAlerts(t))[0]).toMatchObject({ status: "failed" });
  });
});
