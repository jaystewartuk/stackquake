import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog/entries";
import { catalogRequests, depSources, deps, events, projects, sessions, sources, users, type Event } from "../src/db/schema";
import { MONOREPO, serveRepo } from "./fixtures/repos";
import { addSource, resetDb } from "./helpers";
import { Browser, location, webCtx } from "./web";

beforeEach(resetDb);

async function newProject(b: Browser, fields: Record<string, string> = {}): Promise<number> {
  const res = await b.post("/app/projects", { name: "Side project", next: "pick", ...fields });
  return Number(/\/app\/projects\/(\d+)\//.exec(location(res)!)![1]);
}

describe("building a stack from the picker (no repo)", () => {
  it("takes a handful of clicks: sign in, new project, tick services, answer usage, dashboard", async () => {
    const { ctx } = await webCtx();
    const b = new Browser(ctx);
    // 1. Sign in (magic link).
    await b.signIn("solo@example.com");
    // 2. The empty dashboard sends a new user to "What do you run on?".
    expect(location(await b.get("/app"))).toBe("/app/projects/new");
    expect(await b.html("/app/projects/new")).toContain("What do you run on?");
    // 3. Create the project with defaults: commercial, free tier.
    const res = await b.post("/app/projects", { name: "Side project", use: "commercial", tier: "free", next: "pick" });
    const id = Number(/\/app\/projects\/(\d+)\/services/.exec(location(res)!)![1]);
    // 4. The picker: grouped by category, common entries first, searchable.
    const picker = await b.html(`/app/projects/${id}/services`);
    expect(picker.indexOf("Hosting and compute")).toBeLessThan(picker.indexOf("Runtimes and languages"));
    expect(picker).toContain('data-s="cloudflare workers cloudflare workers workers wrangler"');
    // 5. Tick four services and save.
    const ids = ["cloudflare-workers", "supabase", "nodejs", "redis"];
    const save = await b.post(`/app/projects/${id}/services`, { ids, shown: CATALOG.map((e) => e.id) });
    expect(location(save)).toBe(`/app/projects/${id}/profiles?msg=saved`);
    // 6. Usage questions, only those each entry asks; project defaults pre-selected as "Project default".
    const profiles = await b.html(`/app/projects/${id}/profiles`);
    expect(profiles).toContain("Project default (free tier)");
    expect(profiles).not.toContain("<h3 style=\"margin-top:0\">Node.js</h3>"); // nodejs asks nothing
    const depRows = await ctx.db.select().from(deps).where(eq(deps.projectId, id)).all();
    const redis = depRows.find((d) => d.catalogId === "redis")!;
    const done = await b.post(`/app/projects/${id}/profiles`, { [`d${redis.id}_hosting`]: "self_hosted", [`d${redis.id}_use`]: "" });
    expect(location(done)).toBe(`/app/projects/${id}?msg=profiles`);
    // 7. The dashboard.
    const dash = await b.html("/app");
    for (const name of ["Cloudflare Workers", "Supabase", "Node.js", "Redis"]) expect(dash).toContain(name);
    expect(dash).toContain("Single vendor"); // Workers is single_vendor
    expect(depRows.map((d) => d.catalogId).sort()).toEqual([...ids].sort());
    expect((await ctx.db.select().from(deps).where(eq(deps.id, redis.id)).get())!.profile).toEqual({ hosting: "self_hosted" });
    // Each dep links its catalog entry's sources.
    const links = await ctx.db.select().from(depSources).where(eq(depSources.depId, redis.id)).all();
    expect(links.length).toBe(CATALOG.find((e) => e.id === "redis")!.sources.length);
  });

  it("unticks only entries that were on the page, and stores unmatched free text as a request", async () => {
    const { ctx } = await webCtx();
    const b = new Browser(ctx);
    await b.signIn("solo@example.com");
    const id = await newProject(b);
    await b.post(`/app/projects/${id}/services`, { ids: ["supabase", "vercel"], shown: CATALOG.map((e) => e.id) });
    // A filtered page showed only Vercel; Supabase must survive.
    await b.post(`/app/projects/${id}/services`, { shown: ["vercel"], request: "Upstash Redis" });
    const ids = (await ctx.db.select().from(deps).where(eq(deps.projectId, id)).all()).map((d) => d.catalogId);
    expect(ids).toEqual(["supabase"]);
    expect((await ctx.db.select().from(catalogRequests).all()).map((r) => r.text)).toEqual(["Upstash Redis"]);
    // Free text that names an entry (by alias) just adds it.
    await b.post(`/app/projects/${id}/services`, { shown: [], request: "wrangler" });
    expect((await ctx.db.select().from(deps).where(eq(deps.projectId, id)).all()).map((d) => d.catalogId).sort()).toEqual(["cloudflare-workers", "supabase"]);
    expect(await ctx.db.select().from(catalogRequests).all()).toHaveLength(1);
  });

  it("server-side search works without JavaScript", async () => {
    const { ctx } = await webCtx();
    const b = new Browser(ctx);
    await b.signIn("solo@example.com");
    const id = await newProject(b);
    const html = await b.html(`/app/projects/${id}/services?q=workers`);
    expect(html).toContain('value="cloudflare-workers"');
    expect(html).not.toContain('value="supabase"');
  });
});

describe("dep page", () => {
  it("shows sources and events, saves the profile, mutes for 90 days and removes", async () => {
    const { ctx, clock } = await webCtx();
    const b = new Browser(ctx);
    await b.signIn("solo@example.com");
    const id = await newProject(b);
    await b.post(`/app/projects/${id}/services`, { ids: ["supabase"], shown: ["supabase"] });
    const dep = (await ctx.db.select().from(deps).where(eq(deps.projectId, id)).get())!;
    const html = await b.html(`/app/deps/${dep.id}`);
    expect(html).toContain("How do you run it?");
    expect(html).toContain("https://supabase.com/pricing");
    await b.post(`/app/deps/${dep.id}/profile`, { hosting: "hosted", tier: "paid" });
    expect((await ctx.db.select().from(deps).where(eq(deps.id, dep.id)).get())!.profile).toEqual({ hosting: "hosted", tier: "paid" });
    await b.post(`/app/deps/${dep.id}/mute`);
    expect((await ctx.db.select().from(deps).where(eq(deps.id, dep.id)).get())!.mutedUntil).toBe(clock.now() + 90 * 86_400_000);
    expect(await b.html(`/app/deps/${dep.id}`)).toContain("Unmute");
    await b.post(`/app/deps/${dep.id}/unmute`);
    expect((await ctx.db.select().from(deps).where(eq(deps.id, dep.id)).get())!.mutedUntil).toBeNull();
    await b.post(`/app/deps/${dep.id}/delete`);
    expect(await ctx.db.select().from(deps).where(eq(deps.id, dep.id)).get()).toBeUndefined();
    expect(await ctx.db.select().from(depSources).where(eq(depSources.depId, dep.id)).all()).toHaveLength(0);
  });
});

describe("access control", () => {
  it("one user cannot see or change another user's projects or deps", async () => {
    const { ctx } = await webCtx();
    const alice = new Browser(ctx);
    await alice.signIn("alice@example.com");
    const pid = await newProject(alice, { name: "Alice's secret stack" });
    await alice.post(`/app/projects/${pid}/services`, { ids: ["supabase"], shown: ["supabase"] });
    const dep = (await ctx.db.select().from(deps).where(eq(deps.projectId, pid)).get())!;

    const mallory = new Browser(ctx);
    mallory.ip = "198.51.100.66";
    await mallory.signIn("mallory@example.com");
    for (const path of [`/app/projects/${pid}`, `/app/projects/${pid}/services`, `/app/projects/${pid}/profiles`, `/app/projects/${pid}/import`, `/app/deps/${dep.id}`]) {
      expect((await mallory.get(path)).status, path).toBe(404);
    }
    for (const path of [`/app/projects/${pid}`, `/app/projects/${pid}/delete`, `/app/projects/${pid}/services`, `/app/projects/${pid}/profiles`, `/app/projects/${pid}/import`, `/app/deps/${dep.id}/mute`, `/app/deps/${dep.id}/profile`, `/app/deps/${dep.id}/delete`]) {
      expect((await mallory.post(path, { name: "pwned", ids: [], shown: ["supabase"], repo: "a/b", hosting: "hosted" })).status, path).toBe(404);
    }
    expect(await mallory.html("/app/projects/new")).not.toContain("Alice's secret stack");
    expect((await ctx.db.select().from(projects).where(eq(projects.id, pid)).get())!.name).toBe("Alice's secret stack");
    expect(await ctx.db.select().from(deps).where(eq(deps.id, dep.id)).get()).toMatchObject({ mutedUntil: null, profile: {} });
    // And her dashboard does not show Alice's project.
    await newProject(mallory, { name: "Mallory's" });
    expect(await mallory.html("/app")).not.toContain("Alice");
  });

  it("signed-out visitors are sent to sign in", async () => {
    const { ctx } = await webCtx();
    const res = await new Browser(ctx).get("/app/projects/1");
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/signin?next=%2Fapp%2Fprojects%2F1");
  });
});

describe("settings", () => {
  it("saves the digest day", async () => {
    const { ctx } = await webCtx();
    const b = new Browser(ctx);
    await b.signIn("solo@example.com");
    await b.post("/app/settings", { digest_day: "4" });
    expect((await ctx.db.select().from(users).get())!.digestDay).toBe(4);
    await b.post("/app/settings", { digest_day: "9" });
    expect((await ctx.db.select().from(users).get())!.digestDay).toBe(4);
  });

  it("deleting the account removes the user, projects, deps and sessions; sources and events stay", async () => {
    const { ctx, http } = await webCtx();
    serveRepo(http, "acme/shop", MONOREPO);
    const b = new Browser(ctx);
    await b.signIn("solo@example.com");
    const pid = await newProject(b);
    await b.post(`/app/projects/${pid}/services`, { ids: ["supabase"], shown: ["supabase"] });
    const s = await addSource(ctx, { kind: "feed", key: "https://x.example/f", url: "https://x.example/f" });
    await ctx.db.insert(events).values({ sourceId: s.id, kind: "pricing", detectedAt: 1, status: "published", title: "t", quoteUrl: "https://x.example", dedupeKey: "k" });
    const sourceCount = (await ctx.db.select().from(sources).all()).length;
    expect((await b.post("/app/settings/delete", { confirm: "nope" })).status).toBe(302);
    expect(await ctx.db.select().from(users).all()).toHaveLength(1);
    const res = await b.post("/app/settings/delete", { confirm: "DELETE" });
    expect(location(res)).toBe("/?deleted=1");
    expect(await ctx.db.select().from(users).all()).toHaveLength(0);
    expect(await ctx.db.select().from(projects).all()).toHaveLength(0);
    expect(await ctx.db.select().from(deps).all()).toHaveLength(0);
    expect(await ctx.db.select().from(depSources).all()).toHaveLength(0);
    expect(await ctx.db.select().from(sessions).all()).toHaveLength(0);
    expect((await ctx.db.select().from(sources).all()).length).toBe(sourceCount);
    expect(await ctx.db.select().from(events).all()).toHaveLength(1);
  });
});

describe("public pages", () => {
  async function seed() {
    const t = await webCtx();
    const s = (await t.ctx.db.select().from(sources).where(eq(sources.url, "https://supabase.com/pricing")).get())!;
    const ev = (over: Partial<Event>) =>
      t.ctx.db
        .insert(events)
        .values({ sourceId: s.id, catalogId: "supabase", kind: "free_tier", detectedAt: 1, status: "published", publishedAt: Date.UTC(2026, 9, 1), title: "Free projects pause after 3 days", quote: "Free projects are paused after <b>3</b> days of inactivity.", quoteUrl: "https://supabase.com/pricing", dedupeKey: `k${Math.random()}`, note: { material: true, kind: "free_tier", title: "x", what_changed: "Free projects now pause sooner.", quote: "q", effective_date: null, applies_when: { hosting: [], use: [], tier: ["free"] }, who_is_not_affected: "Paid plans.", options: [{ catalog_id: "neon", name: "Neon", why: "Free tier without pausing", effort: "medium" }], uncertain: ["Whether existing projects are included"], confidence: 0.95 }, ...over } as typeof events.$inferInsert)
        .returning()
        .then((r) => r[0]);
    const pub = await ev({});
    const pending = await ev({ status: "pending_review", title: "Secret pending note", publishedAt: null });
    const rejected = await ev({ status: "rejected", title: "Rejected note", publishedAt: null });
    return { ...t, pub, pending, rejected };
  }

  it("show only published events, with quote, source link and the disclaimer", async () => {
    const { ctx, pub, pending, rejected } = await seed();
    const b = new Browser(ctx);
    const list = await b.html("/events");
    expect(list).toContain("Free projects pause after 3 days");
    expect(list).not.toContain("Secret pending note");
    expect(list).not.toContain("Rejected note");
    const page = await b.html(`/events/${pub.id}`);
    expect(page).toContain("Free projects are paused after &lt;b&gt;3&lt;/b&gt; days of inactivity.");
    expect(page).toContain('href="https://supabase.com/pricing"');
    expect(page).toContain("Summary, not legal advice; read the source.");
    expect(page).toContain('<a href="/catalog/neon">Neon</a>');
    expect((await b.get(`/events/${pending.id}`)).status).toBe(404);
    expect((await b.get(`/events/${rejected.id}`)).status).toBe(404);
    const cat = await b.html("/catalog/supabase");
    expect(cat).toContain("Free projects pause after 3 days");
    expect(cat).not.toContain("Secret pending note");
  });

  it("serve an RSS feed of published events", async () => {
    const { ctx, pub } = await seed();
    const res = await new Browser(ctx).get("/events.rss");
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toContain(`<link>https://stackquake.com/events/${pub.id}</link>`);
    expect(xml).toContain("Supabase: Free projects pause after 3 days");
    expect(xml).toContain("&lt;b&gt;3&lt;/b&gt;");
    expect(xml).not.toContain("Secret pending note");
  });

  it("list and search the catalog", async () => {
    const { ctx } = await webCtx();
    const b = new Browser(ctx);
    const all = await b.html("/catalog");
    for (const e of CATALOG) expect(all).toContain(`href="/catalog/${e.id}"`);
    const hits = await b.html("/catalog?q=wrangler");
    expect(hits).toContain("Cloudflare Workers");
    expect(hits).not.toContain('href="/catalog/supabase"');
    expect((await b.get("/catalog/no-such-thing")).status).toBe(404);
    expect(await b.html("/")).toContain("Pick what you run on");
  });
});
