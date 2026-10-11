// M6: plans and limits, Stripe Checkout, Portal and webhook, teams, CSV export (SPEC §10).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { handleEvent, verifyWebhook, type StripeConfig, type StripeEvent } from "../src/billing/stripe";
import { alerts, channels, jobs, projects, teamMembers, users } from "../src/db/schema";
import { handlePush } from "../src/github/webhook";
import { encrypt } from "../src/alerts/secretbox";
import { addDep, addUser, mockResend, note, publish, settle, sourceId } from "./alert-helpers";
import { FixtureHttp, resetDb, TEST_CHANNEL_KEY } from "./helpers";
import { Browser, location, webCtx } from "./web";

beforeEach(resetDb);

const STRIPE: StripeConfig = { secretKey: "rk_test_x", webhookSecret: "whsec_test", priceMonthly: "price_month", priceYearly: "price_year", api: "https://stripe.test" };

async function setup() {
  const http = new FixtureHttp();
  const resend = mockResend(http);
  const t = await webCtx({ http, mailer: resend.mailer });
  t.ctx.config.stripe = STRIPE;
  await t.ctx.db.delete(jobs);
  return { ...t, resend };
}

async function signedIn(t: Awaited<ReturnType<typeof setup>>, email: string) {
  const b = new Browser(t.ctx);
  await b.signIn(email);
  const me = (await t.ctx.db.select().from(users).where(eq(users.email, email)).get())!;
  return { b, me };
}

const setPlan = (t: Awaited<ReturnType<typeof setup>>, id: number, plan: "free" | "team") => t.ctx.db.update(users).set({ plan }).where(eq(users.id, id));

async function sign(body: string, ts: number, secret = STRIPE.webhookSecret): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`)));
  return `t=${ts},v1=${Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

let evSeq = 0;
const ev = (type: string, created: number, object: Record<string, unknown>): StripeEvent => ({ id: `evt_${++evSeq}`, type, created, data: { object } });
const sub = (over: Record<string, unknown> = {}) => ({ id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, items: { data: [{ current_period_end: 1_800_000_000, price: { recurring: { interval: "month" } } }] }, ...over });

describe("Free plan limits", () => {
  it("allows one project, then shows the upgrade page and refuses a second (402)", async () => {
    const t = await setup();
    const { b, me } = await signedIn(t, "free@example.com");
    expect(await b.html("/app/projects/new")).toContain("What do you run on?");
    expect(location(await b.post("/app/projects", { name: "One", next: "pick" }))).toMatch(/\/services$/);
    expect(await b.html("/app/projects/new")).toContain("One project on the Free plan");
    const res = await b.post("/app/projects", { name: "Two", next: "pick" });
    expect(res.status).toBe(402);
    expect(await t.ctx.db.select().from(projects).where(eq(projects.userId, me.id)).all()).toHaveLength(1);

    await setPlan(t, me.id, "team");
    expect(location(await b.post("/app/projects", { name: "Two", next: "pick" }))).toMatch(/\/services$/);
  });

  it("refuses Slack and the CSV export on Free", async () => {
    const t = await setup();
    const { b } = await signedIn(t, "free@example.com");
    const before = t.http.requests.length;
    expect((await b.post("/app/settings/slack", { url: "https://hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx" })).status).toBe(402);
    expect(t.http.requests.length).toBe(before);
    expect(await b.html("/app/settings")).toContain("Slack alerts are on the");
    expect((await b.get("/app/export.csv")).status).toBe(402);
  });

  it("alerts only on a Free owner's oldest project; Team alerts on all of them", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "downgraded@example.com");
    const first = await addDep(t.ctx, u.id, { catalogId: "redis" }, { hosting: "hosted" });
    await addDep(t.ctx, u.id, { catalogId: "redis" }, { hosting: "self_hosted" });
    const src = await sourceId(t.ctx, "npm", "redis");
    await publish(t.ctx, src, { note: { ...note(), applies_when: { hosting: ["self_hosted"], use: [], tier: [] } } });
    await settle(t);
    // The self-hosted dep (the one affected) is in the second project, which is quiet on Free.
    let list = await t.ctx.db.select().from(alerts).all();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ depId: first.id, match: "not_affected", status: "suppressed" });

    await setPlan(t, u.id, "team");
    await publish(t.ctx, src, { title: "Second change", note: { ...note(), applies_when: { hosting: ["self_hosted"], use: [], tier: [] } } });
    await settle(t);
    list = await t.ctx.db.select().from(alerts).all();
    expect(list.find((a) => a.match === "affected")).toBeTruthy();
  });

  it("does not post to a Slack channel kept from before, once the user is on Free", async () => {
    const t = await setup();
    const HOOK = "https://hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx";
    let posts = 0;
    t.http.set(HOOK, () => (posts++, new Response("ok")));
    const u = await addUser(t.ctx, "slackfree@example.com");
    await t.ctx.db.insert(channels).values({ userId: u.id, kind: "slack", webhookUrlEnc: await encrypt(TEST_CHANNEL_KEY, HOOK), verifiedAt: t.clock.now(), hint: "uvwx", createdAt: t.clock.now() });
    await addDep(t.ctx, u.id, { catalogId: "redis" });
    await publish(t.ctx, await sourceId(t.ctx, "npm", "redis"));
    await settle(t);
    expect(posts).toBe(0);
    expect(t.resend.sent).toHaveLength(1);
  });

  it("stops push re-imports of private repos when the owner is not on Team", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "lapsed@example.com");
    await t.ctx.db.insert(projects).values({ userId: u.id, name: "x", repoFullName: "acme/private", githubInstallationId: 42, createdAt: 0 });
    const payload = { ref: "refs/heads/main", repository: { full_name: "acme/private", default_branch: "main" }, installation: { id: 42 }, commits: [{ added: [], modified: ["package.json"], removed: [] }] };
    expect(await handlePush(t.ctx, payload as never)).toBe("no_project");
    await setPlan(t, u.id, "team");
    expect(await handlePush(t.ctx, payload as never)).toMatchObject({ reimported: [expect.any(Number)] });
  });
});

describe("Stripe Checkout and Portal", () => {
  it("creates one customer, then a subscription Checkout for the chosen interval", async () => {
    const t = await setup();
    const calls: { path: string; body: URLSearchParams; auth: string | null }[] = [];
    const record = (answer: object) => async (req: Request) => {
      calls.push({ path: new URL(req.url).pathname, body: new URLSearchParams(await req.text()), auth: req.headers.get("authorization") });
      return Response.json(answer);
    };
    t.http.set("https://stripe.test/v1/customers", record({ id: "cus_new" }));
    t.http.set("https://stripe.test/v1/checkout/sessions", record({ url: "https://checkout.stripe.test/c/pay_1" }));
    t.http.set("https://stripe.test/v1/billing_portal/sessions", record({ url: "https://billing.stripe.test/p/1" }));
    const { b, me } = await signedIn(t, "buyer@example.com");
    expect(await b.html("/app/settings")).toContain("Team, $19/month");

    const res = await b.post("/app/billing/checkout", { interval: "year" });
    expect(res.status).toBe(303);
    expect(location(res)).toBe("https://checkout.stripe.test/c/pay_1");
    expect(calls[0]).toMatchObject({ path: "/v1/customers", auth: "Bearer rk_test_x" });
    expect(calls[0].body.get("email")).toBe("buyer@example.com");
    const s = calls[1].body;
    expect(Object.fromEntries(s)).toMatchObject({ mode: "subscription", "line_items[0][price]": "price_year", customer: "cus_new", client_reference_id: String(me.id), success_url: "https://stackquake.com/app/settings?billing=success" });
    expect((await t.ctx.db.select().from(users).where(eq(users.id, me.id)).get())!.stripeCustomerId).toBe("cus_new");

    await b.post("/app/billing/checkout", { interval: "month" });
    expect(calls.filter((c) => c.path === "/v1/customers")).toHaveLength(1);
    expect(calls.at(-1)!.body.get("line_items[0][price]")).toBe("price_month");

    expect(location(await b.post("/app/billing/portal"))).toBe("https://billing.stripe.test/p/1");
    expect(calls.at(-1)!.body.get("customer")).toBe("cus_new");
  });

  it("hides the upgrade buttons when Stripe is not configured", async () => {
    const t = await setup();
    t.ctx.config.stripe = undefined;
    const { b } = await signedIn(t, "nobilling@example.com");
    expect(await b.html("/app/settings")).toContain("Paid plans aren&#39;t open on this server yet.");
    expect((await b.post("/app/billing/checkout", { interval: "month" })).status).toBe(503);
  });
});

describe("Stripe webhook", () => {
  it("rejects a bad or stale signature and accepts a good one", async () => {
    const t = await setup();
    const body = JSON.stringify(ev("ping", 1, {}));
    const now = Math.floor(t.clock.now() / 1000);
    const post = async (sig: string) => (await new Browser(t.ctx).fetch("/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": sig } })).status;
    expect(await post(await sign(body, now, "whsec_other"))).toBe(400);
    expect(await post(await sign(body, now - 600))).toBe(400);
    expect(await post("t=1")).toBe(400);
    expect(await post(await sign(body, now))).toBe(200);
    await expect(verifyWebhook(body, await sign(body, now), STRIPE.webhookSecret, t.clock.now())).resolves.toMatchObject({ type: "ping" });
  });

  it("sets Team on a paid checkout, once per event id, and follows the subscription", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "sub@example.com", { stripeCustomerId: "cus_1" });
    const get = async () => (await t.ctx.db.select().from(users).where(eq(users.id, u.id)).get())!;

    const done = ev("checkout.session.completed", 100, { mode: "subscription", customer: "cus_1", subscription: "sub_1", client_reference_id: String(u.id), payment_status: "paid" });
    expect(await handleEvent(t.ctx, done)).toBe("applied");
    expect(await get()).toMatchObject({ plan: "team", planStatus: "active", stripeSubscriptionId: "sub_1" });
    expect(await handleEvent(t.ctx, done)).toBe("duplicate");

    expect(await handleEvent(t.ctx, ev("customer.subscription.updated", 200, sub({ status: "past_due", items: { data: [{ current_period_end: 1_800_000_000, price: { recurring: { interval: "year" } } }] } })))).toBe("applied");
    expect(await get()).toMatchObject({ plan: "team", planStatus: "past_due", planInterval: "year", planPeriodEnd: 1_800_000_000_000 });

    // An older event arriving late changes nothing.
    expect(await handleEvent(t.ctx, ev("customer.subscription.updated", 150, sub({ status: "active" })))).toBe("ignored");
    expect((await get()).planStatus).toBe("past_due");

    expect(await handleEvent(t.ctx, ev("customer.subscription.updated", 300, sub({ cancel_at_period_end: true })))).toBe("applied");
    expect(await get()).toMatchObject({ plan: "team", cancelAtPeriodEnd: true });

    // An old subscription ending does not undo the current one.
    expect(await handleEvent(t.ctx, ev("customer.subscription.deleted", 400, sub({ id: "sub_old", status: "canceled" })))).toBe("ignored");
    expect((await get()).plan).toBe("team");

    expect(await handleEvent(t.ctx, ev("customer.subscription.deleted", 500, sub({ status: "canceled" })))).toBe("applied");
    expect(await get()).toMatchObject({ plan: "free", planStatus: "none", cancelAtPeriodEnd: false, planPeriodEnd: null });
  });

  it("leaves the plan alone while a subscription is incomplete, and ignores unknown customers", async () => {
    const t = await setup();
    const u = await addUser(t.ctx, "inc@example.com", { stripeCustomerId: "cus_1" });
    expect(await handleEvent(t.ctx, ev("customer.subscription.created", 100, sub({ status: "incomplete" })))).toBe("applied");
    expect((await t.ctx.db.select().from(users).where(eq(users.id, u.id)).get())!.plan).toBe("free");
    expect(await handleEvent(t.ctx, ev("customer.subscription.updated", 200, sub({ customer: "cus_nobody", metadata: {} })))).toBe("ignored");
  });

  it("cancels the subscription when a Team user deletes their account", async () => {
    const t = await setup();
    let cancelled = "";
    t.http.set("https://stripe.test/v1/subscriptions/sub_9", (req) => ((cancelled = req.method), Response.json({ id: "sub_9", status: "canceled" })));
    const { b, me } = await signedIn(t, "leaving@example.com");
    await t.ctx.db.update(users).set({ plan: "team", stripeCustomerId: "cus_9", stripeSubscriptionId: "sub_9" }).where(eq(users.id, me.id));
    expect(location(await b.post("/app/settings/delete", { confirm: "DELETE" }))).toBe("/?deleted=1");
    expect(cancelled).toBe("DELETE");
    expect(await t.ctx.db.select().from(users).all()).toHaveLength(0);
  });
});

describe("teams", () => {
  it("invite, accept, shared projects and alerts; members lose access when the owner leaves Team", async () => {
    const t = await setup();
    const owner = await signedIn(t, "owner@acme.test");
    await setPlan(t, owner.me.id, "team");
    expect(location(await owner.b.post("/app/projects", { name: "Acme prod", next: "pick" }))).toMatch(/\/services$/);
    const project = (await t.ctx.db.select().from(projects).get())!;
    await owner.b.post(`/app/projects/${project.id}/services`, { ids: "redis", shown: "redis" });

    expect(location(await owner.b.post("/app/team/invite", { email: "Dev@Acme.test" }))).toBe("/app/team?msg=invited");
    expect(t.resend.sent.at(-1)!.body).toMatchObject({ to: ["dev@acme.test"], subject: "owner@acme.test invited you to their Stackquake team" });
    expect((await owner.b.post("/app/team/invite", { email: "dev@acme.test" })).status).toBe(400);

    // Someone else signed in cannot accept an invite for another address.
    const other = await signedIn(t, "other@acme.test");
    const invite = (await t.ctx.db.select().from(teamMembers).get())!;
    await other.b.post(`/app/team/${invite.id}/accept`);
    expect((await t.ctx.db.select().from(teamMembers).get())!.userId).toBeNull();

    const dev = await signedIn(t, "dev@acme.test");
    expect(await dev.b.html("/app/team")).toContain("owner@acme.test</strong> invited you");
    expect(location(await dev.b.post(`/app/team/${invite.id}/accept`))).toBe("/app/team?msg=joined");
    expect(await dev.b.html("/app")).toContain("Acme prod");
    expect((await dev.b.get(`/app/projects/${project.id}`)).status).toBe(200);
    expect((await other.b.get(`/app/projects/${project.id}`)).status).toBe(404);
    // A member's new project belongs to the team.
    await dev.b.post("/app/projects", { name: "Acme staging", next: "pick" });
    expect((await t.ctx.db.select().from(projects).where(eq(projects.name, "Acme staging")).get())!.userId).toBe(owner.me.id);

    await publish(t.ctx, await sourceId(t.ctx, "npm", "redis"));
    await settle(t);
    const sentTo = t.resend.sent.filter((m) => m.body.subject.startsWith("[Stackquake]")).flatMap((m) => m.body.to).sort();
    expect(sentTo).toEqual(["dev@acme.test", "owner@acme.test"]);

    await setPlan(t, owner.me.id, "free");
    expect((await dev.b.get(`/app/projects/${project.id}`)).status).toBe(404);
    await publish(t.ctx, await sourceId(t.ctx, "npm", "redis"), { title: "Another change" });
    await settle(t);
    const after = await t.ctx.db.select().from(alerts).where(eq(alerts.userId, dev.me.id)).all();
    expect(after).toHaveLength(1);
  });

  it("caps a team at 10 people and only the owner on Team can invite", async () => {
    const t = await setup();
    const owner = await signedIn(t, "big@acme.test");
    expect((await owner.b.post("/app/team/invite", { email: "a@acme.test" })).status).toBe(403);
    await setPlan(t, owner.me.id, "team");
    for (let i = 1; i <= 9; i++) expect((await owner.b.post("/app/team/invite", { email: `m${i}@acme.test` })).status).toBe(302);
    expect((await owner.b.post("/app/team/invite", { email: "m10@acme.test" })).status).toBe(400);
    expect(await owner.b.html("/app/team")).toContain("The team is full");
  });
});

describe("CSV export", () => {
  it("lists every dependency with its risk and escapes formula-looking cells", async () => {
    const t = await setup();
    const { b, me } = await signedIn(t, "csv@example.com");
    await setPlan(t, me.id, "team");
    await b.post("/app/projects", { name: "=HYPERLINK(\"x\")", next: "pick" });
    const project = (await t.ctx.db.select().from(projects).get())!;
    await b.post(`/app/projects/${project.id}/services`, { ids: ["redis", "cloudflare-workers"], shown: ["redis", "cloudflare-workers"] });
    const res = await b.get("/app/export.csv");
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toMatch(/^project,repository,dependency,type,details,risk,/);
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(lines.some((l) => l.includes("Redis"))).toBe(true);
  });
});

describe("public pages", () => {
  it("serves the landing, pricing, legal and bot pages, robots.txt and the sitemap", async () => {
    const t = await setup();
    const b = new Browser(t.ctx);
    const home = await b.html("/");
    expect(home).toContain("Pick what you run on");
    expect(home).toContain("docs.socket.dev/docs/organization-alerts");
    const pricing = await b.html("/pricing");
    expect(pricing).toContain("$19");
    expect(pricing).toContain('href="/signin?next=/app/settings"');
    for (const p of ["/terms", "/privacy", "/bot"]) expect((await b.get(p)).status).toBe(200);
    expect(await (await b.get("/robots.txt")).text()).toContain("Disallow: /app");
    const sitemap = await (await b.get("/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://stackquake.com/catalog/cloudflare-workers</loc>");

    const { b: signed } = await signedIn(t, "pricing@example.com");
    expect(await signed.html("/pricing")).toContain('action="/app/billing/checkout"');
  });
});

describe("www", () => {
  it("redirects www to the apex, keeping the path", async () => {
    const t = await setup();
    const { createApp } = await import("../src/web");
    const res = await createApp(() => t.ctx).fetch(new Request("https://www.stackquake.com/pricing?x=1"), {} as never, { waitUntil() {}, passThroughOnException() {} } as never);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://stackquake.com/pricing?x=1");
  });
});
