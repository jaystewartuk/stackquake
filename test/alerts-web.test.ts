// M4 web: one-click links, feedback buttons, settings (digest only, Slack), account deletion.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { LINK_TTL_MS, signLink } from "../src/alerts/links";
import { decrypt } from "../src/alerts/secretbox";
import { alerts, channels, deps, jobs, users } from "../src/db/schema";
import { DAY } from "../src/util";
import { addDep, mockResend, publish, settle, sourceId } from "./alert-helpers";
import { FixtureHttp, resetDb, TEST_CHANNEL_KEY, TEST_LINK_SECRET } from "./helpers";
import { Browser, location, webCtx } from "./web";

beforeEach(resetDb);

async function setup() {
  const http = new FixtureHttp();
  const resend = mockResend(http);
  const t = await webCtx({ http, mailer: resend.mailer });
  await t.ctx.db.delete(jobs);
  const b = new Browser(t.ctx);
  await b.signIn("me@example.com");
  const me = (await t.ctx.db.select().from(users).where(eq(users.email, "me@example.com")).get())!;
  const dep = await addDep(t.ctx, me.id, { catalogId: "redis" });
  await publish(t.ctx, await sourceId(t.ctx, "npm", "redis"));
  await settle(t);
  const alert = (await t.ctx.db.select().from(alerts).get())!;
  return { ...t, resend, b, me, dep, alert };
}

const token = (action: Parameters<typeof signLink>[1], id: number, now: number) => signLink(TEST_LINK_SECRET, action, id, now);

describe("one-click links", () => {
  it("GET only shows a confirm button; POST records the feedback, without signing in", async () => {
    const t = await setup();
    const anon = new Browser(t.ctx);
    const tok = await token("useful", t.alert.id, t.clock.now());
    const page = await anon.html(`/a/${tok}`);
    expect(page).toContain("Mark this alert as useful?");
    expect(page).toContain(`action="/a/${tok}"`);
    expect((await t.ctx.db.select().from(alerts).get())!.feedback).toBeNull();
    expect((await anon.post(`/a/${tok}`)).status).toBe(200);
    expect((await t.ctx.db.select().from(alerts).get())!).toMatchObject({ feedback: "useful", feedbackAt: t.clock.now() });
  });

  it("mute sets the dependency's mute for 90 days", async () => {
    const t = await setup();
    const anon = new Browser(t.ctx);
    const tok = await token("mute", t.alert.id, t.clock.now());
    const confirm = await anon.html(`/a/${tok}`);
    expect(confirm).toContain("Mute Redis for 90 days?");
    expect(confirm).toContain(`No alerts about Redis until ${new Date(t.clock.now() + 90 * DAY).toISOString().slice(0, 10)}.`);
    await anon.post(`/a/${tok}`);
    expect((await t.ctx.db.select().from(deps).where(eq(deps.id, t.dep.id)).get())!.mutedUntil).toBe(t.clock.now() + 90 * DAY);
  });

  it("digest only turns off immediate email", async () => {
    const t = await setup();
    const anon = new Browser(t.ctx);
    const tok = await token("digest_only", t.me.id, t.clock.now());
    await anon.post(`/a/${tok}`);
    expect((await t.ctx.db.select().from(users).where(eq(users.id, t.me.id)).get())!.emailImmediate).toBe(false);
  });

  it("refuses tampered and expired links, and needs the CSRF token", async () => {
    const t = await setup();
    const anon = new Browser(t.ctx);
    const tok = await token("useful", t.alert.id, t.clock.now());
    const forged = tok.replace(/^u\d+/, `u${t.alert.id + 1}`);
    expect((await anon.get(`/a/${forged}`)).status).toBe(400);
    expect((await anon.post(`/a/${forged}`)).status).toBe(400);
    expect((await anon.post(`/a/${tok}`, {}, { csrf: null })).status).toBe(403);
    t.clock.advance(LINK_TTL_MS + DAY);
    const res = await anon.get(`/a/${tok}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("This link has expired");
    expect((await anon.post(`/a/${tok}`)).status).toBe(400);
    expect((await t.ctx.db.select().from(alerts).get())!.feedback).toBeNull();
  });

  it("the links in the email are signed for this alert", async () => {
    const t = await setup();
    const mail = t.resend.sent.find((m) => m.body.subject.startsWith("[Stackquake] Redis"))!.body;
    const mute = /Mute this dependency for 90 days: https:\/\/stackquake\.test(\/a\/\S+)/.exec(mail.text)![1];
    await new Browser(t.ctx).post(mute);
    expect((await t.ctx.db.select().from(deps).where(eq(deps.id, t.dep.id)).get())!.mutedUntil).not.toBeNull();
  });
});

describe("dashboard and dep page", () => {
  it("show the alert with feedback buttons that only work on your own alerts", async () => {
    const t = await setup();
    expect(await t.b.html("/app")).toContain(`action="/app/alerts/${t.alert.id}/feedback"`);
    const depPage = await t.b.html(`/app/deps/${t.dep.id}`);
    expect(depPage).toContain("Licence moves to SSPL");
    expect(depPage).toContain("Affects you because:");
    const res = await t.b.post(`/app/alerts/${t.alert.id}/feedback`, { value: "not_relevant", back: `/app/deps/${t.dep.id}` });
    expect(location(res)).toBe(`/app/deps/${t.dep.id}?msg=feedback`);
    expect((await t.ctx.db.select().from(alerts).get())!.feedback).toBe("not_relevant");

    const other = new Browser(t.ctx);
    await other.signIn("other@example.com");
    await other.post(`/app/alerts/${t.alert.id}/feedback`, { value: "useful" });
    expect((await t.ctx.db.select().from(alerts).get())!.feedback).toBe("not_relevant");
    expect((await other.post(`/app/alerts/${t.alert.id}/feedback`, { value: "evil" })).status).toBe(400);
  });
});

describe("settings", () => {
  const HOOK = "https://hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx";

  it("turns immediate email off and on", async () => {
    const t = await setup();
    await t.b.post("/app/settings", { digest_day: "3" });
    expect((await t.ctx.db.select().from(users).where(eq(users.id, t.me.id)).get())!).toMatchObject({ emailImmediate: false, digestDay: 3 });
    await t.b.post("/app/settings", { digest_day: "3", email_immediate: "1" });
    expect((await t.ctx.db.select().from(users).where(eq(users.id, t.me.id)).get())!.emailImmediate).toBe(true);
  });

  it("connects Slack after a test message, stores the URL encrypted, and disconnects", async () => {
    const t = await setup();
    await t.ctx.db.update(users).set({ plan: "team" }).where(eq(users.id, t.me.id)); // Slack is a Team feature
    const posts: unknown[] = [];
    t.http.set(HOOK, async (req) => {
      posts.push(await req.json());
      return new Response("ok");
    });
    expect((await t.b.post("/app/settings/slack", { url: HOOK })).status).toBe(302);
    expect(posts).toEqual([{ text: "Stackquake is connected. Urgent changes to your stack will be posted here." }]);
    const ch = (await t.ctx.db.select().from(channels).get())!;
    expect(ch.webhookUrlEnc).not.toContain("hooks.slack.com");
    expect(await decrypt(TEST_CHANNEL_KEY, ch.webhookUrlEnc)).toBe(HOOK);
    expect(ch).toMatchObject({ userId: t.me.id, hint: "uvwx", verifiedAt: t.clock.now() });
    expect(await t.b.html("/app/settings")).toContain("webhook ending …uvwx");

    await t.b.post("/app/settings/slack/delete");
    expect(await t.ctx.db.select().from(channels).all()).toHaveLength(0);
  });

  it("refuses URLs that are not Slack webhooks, without fetching them", async () => {
    const t = await setup();
    await t.ctx.db.update(users).set({ plan: "team" }).where(eq(users.id, t.me.id)); // Slack is a Team feature
    const before = t.http.requests.length;
    for (const url of ["https://evil.example/hook", "https://hooks.slack.com@evil.example/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx", "http://169.254.169.254/latest/meta-data"]) {
      expect((await t.b.post("/app/settings/slack", { url })).status).toBe(400);
    }
    expect(t.http.requests.length).toBe(before);
    expect(await t.ctx.db.select().from(channels).all()).toHaveLength(0);
  });

  it("does not store a webhook Slack refuses", async () => {
    const t = await setup();
    await t.ctx.db.update(users).set({ plan: "team" }).where(eq(users.id, t.me.id)); // Slack is a Team feature
    t.http.set(HOOK, new Response("no_service", { status: 404 }));
    const res = await t.b.post("/app/settings/slack", { url: HOOK });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("no_service");
    expect(await t.ctx.db.select().from(channels).all()).toHaveLength(0);
  });
});

describe("account deletion", () => {
  it("removes alerts, channels and their jobs", async () => {
    const t = await setup();
    t.http.set("https://hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx", new Response("ok"));
    await t.b.post("/app/settings/slack", { url: "https://hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx" });
    // A queued delivery and digest for this user.
    await publish(t.ctx, await sourceId(t.ctx, "npm", "redis"), { title: "Second change" });
    await settle(t, 1, 0, false);
    await t.ctx.db.insert(jobs).values({ kind: "digest", payload: { userId: t.me.id, day: 0 }, runAfter: t.clock.now(), dedupeKey: "digest:x" });
    expect(await t.ctx.db.select().from(jobs).all()).not.toHaveLength(0);

    expect(location(await t.b.post("/app/settings/delete", { confirm: "DELETE" }))).toBe("/?deleted=1");
    expect(await t.ctx.db.select().from(alerts).all()).toHaveLength(0);
    expect(await t.ctx.db.select().from(channels).all()).toHaveLength(0);
    expect((await t.ctx.db.select().from(jobs).all()).filter((j) => j.kind === "deliver" || j.kind === "digest")).toHaveLength(0);
  });
});
