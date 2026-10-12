// Staging-only admin tools (M5). Staging has no Cron Trigger (the account's 5 are spoken for, and
// a second poller would double vendor traffic and LLM spend), so the admin runs a tick or the
// daily run by hand, and can add a clearly-labelled sample event to walk the alert path end to end:
// approve on /admin/events → fan-out → delivery by email and Slack. On only when STAGING_TOOLS=1.
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { CATALOG } from "../catalog/entries";
import { catalogSources, events } from "../db/schema";
import { runCron } from "../jobs/cron";
import type { Note } from "../llm/schemas";
import { Csrf, page } from "../web/layout";
import { PageHeader } from "../web/ui";
import { requireAdmin, type WebEnv } from "../web/session";

export const stagingRoutes = new Hono<WebEnv>();
stagingRoutes.use("*", requireAdmin);
stagingRoutes.use("*", async (c, next) => (c.env.STAGING_TOOLS === "1" ? next() : c.notFound()));

stagingRoutes.get("/", (c) => {
  const result = c.req.query("result");
  return page(
    c,
    "Staging tools",
    <>
      <PageHeader crumbs={[{ href: "/admin/events", label: "Admin" }]} title="Staging tools" description="This environment has no cron trigger. Run the scheduler by hand." />
      {result && <pre>{result}</pre>}
      <form method="post" action="/admin/staging/run" class="row panel">
        <Csrf token={c.get("csrf")} />
        <button type="submit" name="task" value="tick">
          Run a tick
        </button>
        <button type="submit" name="task" value="daily">
          Run the daily job
        </button>
      </form>
      <h2>Sample event</h2>
      <p>Adds a pending-review free-tier change on the entry's first source, marked as a test. Approve it on the review queue to send alerts to everyone whose stack has that entry.</p>
      <form method="post" action="/admin/staging/sample-event" class="row panel">
        <Csrf token={c.get("csrf")} />
        <select name="catalog" aria-label="Catalog entry" style="flex:1 1 14rem;width:auto">
          {CATALOG.map((e) => (
            <option value={e.id} selected={e.id === "cloudflare-workers"}>
              {e.name}
            </option>
          ))}
        </select>
        <button type="submit">Add sample event</button>
      </form>
    </>,
    { noindex: true },
  );
});

stagingRoutes.post("/run", async (c) => {
  const form = await c.req.parseBody();
  const task = form.task === "daily" ? "daily" : "tick";
  const report = await runCron(c.get("ctx"), task, CATALOG);
  return c.redirect(`/admin/staging?result=${encodeURIComponent(`${task}: ${JSON.stringify(report)}`.slice(0, 1_500))}`);
});

stagingRoutes.post("/sample-event", async (c) => {
  const ctx = c.get("ctx");
  const form = await c.req.parseBody();
  const entry = CATALOG.find((e) => e.id === form.catalog);
  if (!entry) return c.notFound();
  const link = await ctx.db.select({ sourceId: catalogSources.sourceId }).from(catalogSources).where(eq(catalogSources.catalogId, entry.id)).limit(1).get();
  if (!link) return c.redirect(`/admin/staging?result=${encodeURIComponent("Catalog not synced yet: run the daily job first.")}`);
  const now = ctx.clock.now();
  const stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ");
  const quote = `[Staging test ${stamp}] The free allowance drops from 100,000 to 50,000 requests per day.`;
  const note: Note = {
    material: true,
    kind: "free_tier",
    title: `[Test] ${entry.name}: free allowance halved`,
    what_changed: `This is a staging test event, not a real change. It pretends the ${entry.name} free tier now includes half as many requests per day.`,
    quote,
    effective_date: null,
    applies_when: { hosting: [], use: [], tier: ["free"] },
    who_is_not_affected: "Paid plans.",
    options: (entry.alternatives ?? []).slice(0, 2).map((id) => ({ catalog_id: id, name: CATALOG.find((e) => e.id === id)?.name ?? id, why: "Sample option.", effort: "medium" as const })),
    uncertain: ["Everything: this is a test."],
    confidence: 0.95,
  };
  const [e] = await ctx.db
    .insert(events)
    .values({
      sourceId: link.sourceId,
      catalogId: entry.id,
      kind: "free_tier",
      detectedAt: now,
      status: "pending_review",
      confidence: 0.95,
      title: note.title,
      quote,
      quoteUrl: `${ctx.config.appOrigin}/admin/staging`,
      afterText: quote,
      note,
      appliesWhen: note.applies_when,
      dedupeKey: `staging-test:${now}`,
      reviewReason: "staging sample event",
    })
    .returning();
  return c.redirect(`/admin/events#e${e.id}`);
});
