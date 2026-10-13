// Local-only routes used by `npm run poll` (scripts/poll.mjs drives them under `wrangler dev`).
import { and, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { enqueueFanout } from "./alerts/fanout";
import { renderAlertEmail } from "./alerts/render";
import { Hono } from "hono";
import { syncCatalog } from "./catalog/catalog";
import { CATALOG } from "./catalog/entries";
import { catalogSources, events, jobs, sessions, sources, users, type Source } from "./db/schema";
import { makeCtx, type AppEnv } from "./env";
import { completeJob, enqueue } from "./jobs/queue";
import { extractDiff } from "./watch/extract-diff";
import { recordEvent } from "./watch/events";
import { loadSnapshot, pollSafely, snapshotKey, type PollReport } from "./watch/poll";
import { gzip, sha256Hex, utf8 } from "./util";
import { seedDemo } from "./dev-seed";
import { galleryHtml } from "./web/gallery";
import { signLink, type LinkAction } from "./alerts/links";
import { randomToken, SESSION_MS } from "./web/session";

export const devRoutes = new Hono<{ Bindings: AppEnv }>();

devRoutes.use("*", async (c, next) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_ROUTES !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(host)) return c.notFound();
  await next();
});

/** Resolves "all", a numeric source id, a catalog id, or "kind:key". */
async function resolveTargets(ctx: ReturnType<typeof makeCtx>, target: string): Promise<Source[]> {
  if (target === "all") return ctx.db.select().from(sources).where(eq(sources.state, "active")).all();
  if (/^\d+$/.test(target)) return ctx.db.select().from(sources).where(eq(sources.id, Number(target))).all();
  const linked = await ctx.db.select({ id: catalogSources.sourceId }).from(catalogSources).where(eq(catalogSources.catalogId, target)).all();
  if (linked.length) return ctx.db.select().from(sources).where(inArray(sources.id, linked.map((l) => l.id))).all();
  const i = target.indexOf(":");
  if (i > 0) {
    const kind = target.slice(0, i) as Source["kind"];
    return ctx.db.select().from(sources).where(and(eq(sources.kind, kind), eq(sources.key, target.slice(i + 1)))).all();
  }
  return [];
}

// The component gallery (docs/design/DIRECTION.md): every shared component, light and dark.
devRoutes.get("/ui", (c) => c.html(galleryHtml()));

devRoutes.post("/poll", async (c) => {
  const ctx = makeCtx(c.env);
  await syncCatalog(ctx, CATALOG);
  const target = c.req.query("target") ?? "";
  const targets = await resolveTargets(ctx, target);
  if (!targets.length) return c.json({ error: `no source matches "${target}"` }, 404);

  // Different hosts in parallel, one request at a time per host.
  const byHost = new Map<string, Source[]>();
  for (const s of targets) {
    const host = new URL(s.url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), s]);
  }
  const reports: PollReport[] = [];
  await Promise.all(
    [...byHost.values()].map(async (list) => {
      for (const s of list) reports.push(await pollSafely(ctx, s));
    }),
  );

  // Run the page diff steps queued by this poll right away, so the CLI shows their events.
  const ids = targets.map((t) => t.id);
  const diffs = await ctx.db.select().from(jobs).where(and(eq(jobs.kind, "extract_diff"), inArray(jobs.sourceId, ids), isNull(jobs.parkedAt))).all();
  const diffResults = [];
  for (const job of diffs) {
    const source = targets.find((t) => t.id === job.sourceId)!;
    const p = job.payload as { oldSha: string; newSha: string };
    diffResults.push({ sourceId: source.id, url: source.url, result: await extractDiff(ctx, source, p.oldSha, p.newSha) });
    await completeJob(ctx, job);
  }

  const since = Number(c.req.query("since") ?? "0");
  const newEvents = await ctx.db
    .select({ id: events.id, sourceId: events.sourceId, kind: events.kind, title: events.title, detectedAt: events.detectedAt })
    .from(events)
    .where(inArray(events.sourceId, ids))
    .all();
  // --show: the stored canonical text of each source, to check selectors and normalisation.
  const shown: Record<number, string | null> = {};
  if (c.req.query("show") === "1") {
    for (const r of reports) shown[r.sourceId] = r.sha256 ? await loadSnapshot(ctx, r.sha256) : null;
  }
  return c.json({
    shown,
    reports: reports.sort((a, b) => a.sourceId - b.sourceId),
    diffs: diffResults,
    events: newEvents.filter((e) => e.detectedAt >= since),
  });
});

/**
 * Seeds one event of each pipeline path (used by scripts/measure-cpu.mjs): a feed item whose post
 * is at `postUrl`, a page diff between two texts, and an npm licence change.
 */
devRoutes.post("/seed-pipeline", async (c) => {
  const ctx = makeCtx(c.env);
  const { postUrl, before, after } = await c.req.json<{ postUrl: string; before: string; after: string }>();
  const byKind = async (kind: Source["kind"]) => (await ctx.db.select().from(sources).where(eq(sources.kind, kind)).limit(1).get())!;
  const feed = await byKind("feed");
  const page = await byKind("page");
  const npm = await byKind("npm");
  await recordEvent(ctx, { sourceId: feed.id, sourceKind: "feed", catalogId: "deno", change: { kind: "other", title: "Deno is joining Cloudflare", dedupeTitle: `feed item ${postUrl} ${Date.now()}`, quoteUrl: postUrl, afterText: "Today we are announcing that the Deno team is joining Cloudflare." } });
  const [oldSha, newSha] = await Promise.all([sha256Hex(before), sha256Hex(after)]);
  for (const [sha, text] of [[oldSha, before], [newSha, after]]) await ctx.blobs.put(snapshotKey(sha), await gzip(utf8(text)));
  await enqueue(ctx, { kind: "extract_diff", sourceId: page.id, payload: { oldSha, newSha }, dedupeKey: `diff:${page.id}:${oldSha}:${newSha}` });
  await recordEvent(ctx, { sourceId: npm.id, sourceKind: "npm", catalogId: null, change: { kind: "license", title: `${npm.key} (npm): licence changed from MIT to BUSL-1.1`, dedupeTitle: `licence MIT -> BUSL-1.1 ${Date.now()}`, quoteUrl: npm.url, beforeText: '"license": "MIT"', afterText: '"license": "BUSL-1.1" (version 9.0.0)' } });
  return c.json({ ok: true });
});

/**
 * Seeds alert work (used by scripts/measure-cpu.mjs): `users` users, each with a project whose
 * Redis dep links the npm redis source; every `affectedEvery`-th runs it self-hosted. Then
 * publishes a self-hosted licence change (urgent: deliveries) and a pricing change for everyone
 * (held for the digest), and queues their fan-out. The first `digestUsers` affected users get
 * today as their digest day.
 */
devRoutes.post("/seed-alerts", async (c) => {
  const ctx = makeCtx(c.env);
  const { users: n, affectedEvery, digestUsers } = await c.req.json<{ users: number; affectedEvery: number; digestUsers: number }>();
  const now = ctx.clock.now();
  const today = new Date(now).getUTCDay();
  const src = (await ctx.db.select().from(sources).where(and(eq(sources.kind, "npm"), eq(sources.key, "redis"))).get())!;
  await ctx.db.run(sql`WITH RECURSIVE i(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM i WHERE x < ${n})
    INSERT INTO users (id, email, digest_day, created_at)
    SELECT 100000 + x, 'measure' || x || '@example.com',
           CASE WHEN x % ${affectedEvery} = 0 AND x / ${affectedEvery} <= ${digestUsers} THEN ${today} ELSE ${(today + 1) % 7} END, ${now} FROM i`);
  await ctx.db.run(sql`INSERT INTO projects (id, user_id, name, default_profile, created_at) SELECT id, id, 'Measured', '{}', ${now} FROM users WHERE id > 100000`);
  await ctx.db.run(sql`INSERT INTO deps (id, project_id, catalog_id, profile, origin, dep_key, created_at)
    SELECT id, id, 'redis', CASE WHEN (id - 100000) % ${affectedEvery} = 0 THEN '{"hosting":"self_hosted"}' ELSE '{"hosting":"hosted"}' END, 'manual', 'catalog:redis', ${now}
    FROM projects WHERE id > 100000`);
  await ctx.db.run(sql`INSERT INTO dep_sources (dep_id, source_id) SELECT id, ${src.id} FROM deps WHERE id > 100000`);
  const base = { sourceId: src.id, catalogId: "redis", detectedAt: now, publishedAt: now, status: "published" as const, confidence: 0.95, quoteUrl: "https://www.npmjs.com/package/redis" };
  const note = (kind: "license" | "pricing", title: string, hosting: ("hosted" | "self_hosted")[]) => ({
    material: true, kind, title, what_changed: "Measured change. ".repeat(10), quote: '"license": "SSPL-1.0"', effective_date: null,
    applies_when: { hosting, use: [], tier: [] }, who_is_not_affected: null,
    options: [{ catalog_id: "valkey", name: "Valkey", why: "BSD-licensed fork", effort: "low" }], uncertain: ["Whether older versions change"], confidence: 0.95,
  });
  for (const [kind, title, hosting] of [["license", "Redis licence moves to SSPL", ["self_hosted"]], ["pricing", "Redis Cloud prices change", []]] as const) {
    const n = note(kind, title, [...hosting]);
    const [e] = await ctx.db.insert(events).values({ ...base, kind, title, quote: n.quote, note: n, appliesWhen: n.applies_when, dedupeKey: `measure:${kind}:${now}` }).returning();
    await enqueueFanout(ctx, e.id);
  }
  return c.json({ ok: true });
});

/**
 * Makes queued polls (or, with ?pipeline=1, pipeline steps) due now (used by
 * scripts/measure-cpu.mjs). With ?within=ms, only jobs due within that window (deferred ones) are
 * moved.
 */
devRoutes.post("/due", async (c) => {
  const ctx = makeCtx(c.env);
  const now = ctx.clock.now();
  const within = Number(c.req.query("within") ?? "Infinity");
  // ?pipeline=1: the event pipeline's jobs instead of polls.
  const kind = c.req.query("pipeline") === "1" ? ne(jobs.kind, "poll") : eq(jobs.kind, "poll");
  const cond = Number.isFinite(within) ? and(kind, lte(jobs.runAfter, now + within)) : kind;
  await ctx.db.update(jobs).set({ runAfter: now, lockedUntil: null }).where(cond);
  return c.json({ ok: true });
});

/**
 * Creates (or finds) a user and a session; returns the cookie value (scripts/measure-cpu.mjs).
 * `plan: "team"` puts the user on Team, so a script can create more than one project.
 */
devRoutes.post("/session", async (c) => {
  const ctx = makeCtx(c.env);
  const { email, plan } = await c.req.json<{ email: string; plan?: "free" | "team" }>();
  await ctx.db.insert(users).values({ email, createdAt: ctx.clock.now() }).onConflictDoNothing({ target: users.email });
  if (plan) await ctx.db.update(users).set({ plan, planStatus: plan === "team" ? "active" : "none" }).where(eq(users.email, email));
  const user = (await ctx.db.select().from(users).where(eq(users.email, email)).get())!;
  const token = randomToken();
  await ctx.db.insert(sessions).values({ id: await sha256Hex(token), userId: user.id, expiresAt: ctx.clock.now() + SESSION_MS, createdAt: ctx.clock.now() });
  return c.json({ token, csrf: (await sha256Hex(`csrf:${token}`)).slice(0, 32) });
});

/**
 * Sends one sample alert (the Deno note from the golden set) through the configured mailer: with
 * the AWS_SES keys in .dev.vars, a real email through Amazon SES (the address must be verified
 * while the account is in the sandbox); else with RESEND_API_KEY, through Resend. The response names
 * the mailer. Body: {"to": "you@example.com"}.
 */
devRoutes.post("/test-email", async (c) => {
  const ctx = makeCtx(c.env);
  const { to } = await c.req.json<{ to: string }>();
  const quote = "We will support the Deno runtime for another year with monthly releases containing bug fixes and security updates. After that year we will end our development of the Deno runtime.";
  const mail = renderAlertEmail(
    {
      name: "Deno",
      event: {
        id: 1,
        kind: "eol",
        title: "Deno runtime development ends in about a year",
        quote,
        quoteUrl: "https://deno.com/blog/deno-joins-cloudflare",
        effectiveDate: "2027-10",
        note: {
          material: true, kind: "eol", title: "Deno runtime development ends in about a year",
          what_changed: "The Deno team is joining Cloudflare. The Deno runtime gets monthly bug-fix and security releases for one more year, then development ends.",
          quote, effective_date: "2027-10", applies_when: { hosting: [], use: [], tier: [] }, who_is_not_affected: null,
          options: [{ catalog_id: "nodejs", name: "Node.js 24 LTS", why: "Mature runtime; most Deno code runs with small changes.", effort: "medium" }, { catalog_id: "bun", name: "Bun", why: "TypeScript-first like Deno.", effort: "medium" }],
          uncertain: ["What happens to Deno Deploy"], confidence: 0.95,
        },
      },
      because: "you use Deno in My stack, and the change applies to everyone who uses it.",
      links: { useful: `${ctx.config.appOrigin}/a/sample-useful`, notRelevant: `${ctx.config.appOrigin}/a/sample-not-relevant`, mute: `${ctx.config.appOrigin}/a/sample-mute` },
      eventUrl: `${ctx.config.appOrigin}/events/1`,
    },
    { settingsUrl: `${ctx.config.appOrigin}/app/settings` },
  );
  await ctx.mailer.send({ to, ...mail, idempotencyKey: `test-email-${Date.now()}` });
  return c.json({ ok: true, subject: mail.subject, mailer: ctx.mailer.constructor.name });
});

devRoutes.get("/sources", async (c) => {
  const ctx = makeCtx(c.env);
  return c.json(await ctx.db.select().from(sources).all());
});

/** Wipes users, projects, events and alerts, then writes the demo data (src/dev-seed.ts; `npm run ui:seed`). */
devRoutes.post("/seed", async (c) => c.json(await seedDemo(makeCtx(c.env))));

/** A signed one-click alert link (/a/{token}) for screenshots of the confirm page. */
devRoutes.get("/link", async (c) => {
  const ctx = makeCtx(c.env);
  if (!ctx.config.linkSecret) return c.json({ error: "LINK_SECRET is not set" }, 400);
  const token = await signLink(ctx.config.linkSecret, (c.req.query("action") ?? "mute") as LinkAction, Number(c.req.query("id") ?? "1"), ctx.clock.now());
  return c.json({ path: `/a/${token}` });
});
