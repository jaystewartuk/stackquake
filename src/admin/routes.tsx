// /admin (SPEC §7.3 step 4, §7.6): the review queue. Minimal server-rendered pages: list events
// waiting for review with their quote, before/after text and source link; approve, edit or
// reject each in one click. Everything fetched is rendered as text (JSX escapes it) and links
// are only rendered for http(s) URLs.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { budgetState } from "../alerts/budget";
import { enqueueFanout } from "../alerts/fanout";
import { catalogRequests, EVENT_KINDS, events, jobs, llmCalls, sources, users, type Event, type EventKind, type EventStatus } from "../db/schema";
import type { Note } from "../llm/schemas";
import { getText } from "../pipeline/post";
import { quoteFound } from "../pipeline/quote";
import { DAY } from "../util";
import { Csrf, fmtDate, page, safeHref } from "../web/layout";
import { requireAdmin, type WebContext, type WebEnv } from "../web/session";

export const adminRoutes = new Hono<WebEnv>();
adminRoutes.use("*", requireAdmin);

const STATUSES: EventStatus[] = ["pending_review", "published", "rejected", "pending_llm"];

adminRoutes.get("/", (c) => c.redirect("/admin/events"));

const AdminNav = ({ staging }: { staging?: boolean }) => (
  <nav class="row" style="margin-bottom:1rem">
    <a href="/admin/events">Review queue</a>
    <a href="/admin/sources">Blocked sources</a>
    <a href="/admin/requests">Catalog requests</a>
    {staging && <a href="/admin/staging">Staging tools</a>}
  </nav>
);

const EventCard: FC<{ e: Event; csrf: string }> = ({ e, csrf }) => {
  const n = e.note as Note | null;
  const href = safeHref(e.quoteUrl);
  return (
    <article id={`e${e.id}`}>
      <h2>
        #{e.id} {e.title}
      </h2>
      <div class="meta">
        {e.kind} · {e.catalogId ?? `source ${e.sourceId}`} · confidence {e.confidence?.toFixed(2) ?? "–"} · detected {new Date(e.detectedAt).toISOString().slice(0, 16).replace("T", " ")}
        {e.effectiveDate ? ` · effective ${e.effectiveDate}` : ""} · {e.status}
        {e.duplicateOf ? ` · duplicate of #${e.duplicateOf}` : ""}
      </div>
      {e.reviewReason && <p class="meta">Why: {e.reviewReason}</p>}
      <p>{href ? <a href={href} rel="noopener noreferrer nofollow" target="_blank">{e.quoteUrl}</a> : e.quoteUrl}</p>
      {e.quote && (
        <>
          <blockquote>{e.quote}</blockquote>
          <div class={e.quoteFound ? "meta ok" : "meta bad"}>{e.quoteFound ? "Quote found in the source" : "Quote NOT found in the source"}</div>
        </>
      )}
      {n && (
        <>
          <p>{n.what_changed}</p>
          {n.who_is_not_affected && <p class="meta">Not affected: {n.who_is_not_affected}</p>}
          <p class="meta">
            Applies when: hosting {n.applies_when.hosting.join("/") || "any"}, use {n.applies_when.use.join("/") || "any"}, tier {n.applies_when.tier.join("/") || "any"}
          </p>
          {n.options.length > 0 && (
            <ul>
              {n.options.map((o) => (
                <li>
                  {o.name} ({o.effort}): {o.why}
                </li>
              ))}
            </ul>
          )}
          {n.uncertain.length > 0 && <p class="meta">Uncertain: {n.uncertain.join(" · ")}</p>}
        </>
      )}
      {(e.beforeText || e.afterText) && (
        <div class="cols">
          <div>
            <div class="meta">Before</div>
            <pre>{e.beforeText ?? ""}</pre>
          </div>
          <div>
            <div class="meta">After</div>
            <pre>{e.afterText ?? ""}</pre>
          </div>
        </div>
      )}
      {e.status !== "published" && (
        <form class="inline" method="post" action={`/admin/events/${e.id}/approve`}>
          <Csrf token={csrf} />
          <button type="submit" disabled={!n || !e.quote}>
            Approve
          </button>
        </form>
      )}
      <a href={`/admin/events/${e.id}`}>Edit</a>{" "}
      {e.status !== "rejected" && (
        <form class="inline" method="post" action={`/admin/events/${e.id}/reject`}>
          <Csrf token={csrf} />
          <button type="submit">Reject</button>
        </form>
      )}
    </article>
  );
};

adminRoutes.get("/events", async (c) => {
  const ctx = c.get("ctx");
  const status = (STATUSES as string[]).includes(c.req.query("status") ?? "") ? (c.req.query("status") as EventStatus) : "pending_review";
  const list = await ctx.db.select().from(events).where(eq(events.status, status)).orderBy(desc(events.detectedAt)).limit(50).all();
  const counts = await ctx.db.select({ status: events.status, n: sql<number>`count(*)` }).from(events).groupBy(events.status).all();
  const week = await ctx.db
    .select({ usd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`, calls: sql<number>`count(*)` })
    .from(llmCalls)
    .where(gt(llmCalls.createdAt, c.get("ctx").clock.now() - 7 * DAY))
    .get();
  const budget = await budgetState(ctx);
  // G3: alerts per week and the share marked "not relevant".
  const [al] = await ctx.db.all<{ sent: number; held: number; suppressed: number; useful: number; not_relevant: number }>(sql`
    SELECT count(*) FILTER (WHERE status = 'sent') AS sent,
           count(*) FILTER (WHERE status = 'queued' AND channel = 'digest') AS held,
           count(*) FILTER (WHERE status = 'suppressed') AS suppressed,
           count(*) FILTER (WHERE feedback = 'useful') AS useful,
           count(*) FILTER (WHERE feedback = 'not_relevant') AS not_relevant
    FROM alerts WHERE created_at > ${ctx.clock.now() - 7 * DAY}`);
  const n = (s: string) => counts.find((r) => r.status === s)?.n ?? 0;
  const flash = c.req.query("msg");
  return page(
    c,
    "Admin: events",
    <>
      <AdminNav staging={c.env.STAGING_TOOLS === "1"} />
      <h1>Events: {status.replace("_", " ")}</h1>
      <nav class="row">
        {STATUSES.map((s) => (
          <a href={`/admin/events?status=${s}`}>
            {s.replace("_", " ")} ({n(s)})
          </a>
        ))}
      </nav>
      <p class="meta">
        LLM, last 7 days: ${(week?.usd ?? 0).toFixed(4)} over {week?.calls ?? 0} calls; weekly budget ${budget.budget.toFixed(2)}.{" "}
        {budget.paused ? (
          <strong class="pill bad">over twice the budget: classify paused, admins emailed daily</strong>
        ) : budget.over ? (
          <strong class="pill warn">over budget: admins emailed daily; classify pauses at ${(2 * budget.budget).toFixed(2)}</strong>
        ) : null}
      </p>
      <p class="meta">
        Alerts, last 7 days: {al.sent} sent, {al.held} held for digests, {al.suppressed} suppressed; feedback {al.useful} useful, {al.not_relevant} not relevant.
      </p>
      {flash && <p class="flash error">{flash}</p>}
      {list.length === 0 ? <p>Nothing here.</p> : list.map((e) => <EventCard e={e} csrf={c.get("csrf")} />)}
    </>,
    { noindex: true },
  );
});

async function loadEvent(c: WebContext): Promise<Event | undefined> {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return undefined;
  return c.get("ctx").db.select().from(events).where(eq(events.id, id)).get();
}

adminRoutes.post("/events/:id/approve", async (c) => {
  const e = await loadEvent(c);
  if (!e) return c.notFound();
  if (!e.note || !e.quote) return c.redirect(`/admin/events?msg=${encodeURIComponent(`#${e.id} has no note or quote: edit it first`)}`);
  await c.get("ctx")
    .db.update(events)
    .set({ status: "published", publishedAt: c.get("ctx").clock.now(), reviewReason: `approved by admin${e.reviewReason ? ` (was: ${e.reviewReason})` : ""}`.slice(0, 1_000) })
    .where(eq(events.id, e.id));
  await enqueueFanout(c.get("ctx"), e.id);
  return c.redirect("/admin/events");
});

adminRoutes.post("/events/:id/reject", async (c) => {
  const e = await loadEvent(c);
  if (!e) return c.notFound();
  await c.get("ctx")
    .db.update(events)
    .set({ status: "rejected", publishedAt: null, reviewReason: `rejected by admin${e.reviewReason ? ` (was: ${e.reviewReason})` : ""}`.slice(0, 1_000) })
    .where(and(eq(events.id, e.id)));
  return c.redirect("/admin/events");
});

adminRoutes.get("/events/:id", async (c) => {
  const e = await loadEvent(c);
  if (!e) return c.notFound();
  const n = e.note as Note | null;
  return page(
    c,
    `Edit #${e.id}`,
    <>
      <p>
        <a href="/admin/events">← Events</a>
      </p>
      <EventCard e={e} csrf={c.get("csrf")} />
      <h2>Edit and publish</h2>
      <form method="post" action={`/admin/events/${e.id}`}>
        <Csrf token={c.get("csrf")} />
        <label for="kind">Kind</label>
        <select id="kind" name="kind">
          {EVENT_KINDS.map((k) => (
            <option value={k} selected={k === e.kind}>
              {k}
            </option>
          ))}
        </select>
        <label for="title">Title</label>
        <input type="text" id="title" name="title" value={e.title} required maxlength={300} />
        <label for="what_changed">What changed</label>
        <textarea id="what_changed" name="what_changed" required>
          {n?.what_changed ?? ""}
        </textarea>
        <label for="quote">Quote (verbatim from the source)</label>
        <textarea id="quote" name="quote" required>
          {e.quote ?? ""}
        </textarea>
        <label for="effective_date">Effective date (YYYY-MM-DD or YYYY-MM)</label>
        <input type="text" id="effective_date" name="effective_date" value={e.effectiveDate ?? ""} pattern="\d{4}-\d{2}(-\d{2})?" />
        <p>
          <button type="submit">Save and publish</button>
        </p>
      </form>
    </>,
    { noindex: true },
  );
});

adminRoutes.post("/events/:id", async (c) => {
  const e = await loadEvent(c);
  if (!e) return c.notFound();
  const form = await c.req.parseBody();
  const str = (k: string) => (typeof form[k] === "string" ? (form[k] as string).trim() : "");
  const kind = str("kind") as EventKind;
  const effective = str("effective_date") || null;
  if (!EVENT_KINDS.includes(kind) || !str("title") || !str("quote") || !str("what_changed") || (effective && !/^\d{4}-\d{2}(-\d{2})?$/.test(effective))) {
    return c.text("Kind, title, what changed and quote are required; the date must be YYYY-MM[-DD].", 400);
  }
  const ctx = c.get("ctx");
  const corpus = [e.beforeText, e.afterText];
  for (const key of e.sourceKeys ?? []) corpus.push(await getText(ctx, key));
  const base: Note = (e.note as Note | null) ?? {
    material: true,
    kind,
    title: "",
    what_changed: "",
    quote: "",
    effective_date: null,
    applies_when: { hosting: [], use: [], tier: [] },
    who_is_not_affected: null,
    options: [],
    uncertain: [],
    confidence: 1,
  };
  const note: Note = { ...base, kind, title: str("title"), what_changed: str("what_changed"), quote: str("quote"), effective_date: effective };
  await ctx.db
    .update(events)
    .set({
      kind,
      title: note.title.slice(0, 300),
      note,
      quote: note.quote,
      quoteFound: quoteFound(note.quote, corpus),
      effectiveDate: effective,
      appliesWhen: note.applies_when,
      status: "published",
      publishedAt: c.get("ctx").clock.now(),
      reviewReason: "edited and approved by admin",
    })
    .where(eq(events.id, e.id));
  await enqueueFanout(ctx, e.id);
  return c.redirect("/admin/events");
});

adminRoutes.get("/sources", async (c) => {
  const ctx = c.get("ctx");
  const list = await ctx.db.select().from(sources).where(sql`${sources.state} = 'blocked' OR ${sources.lastError} IS NOT NULL`).orderBy(desc(sources.state), sources.id).limit(200).all();
  const parked = await ctx.db.select().from(jobs).where(sql`${jobs.parkedAt} IS NOT NULL`).orderBy(desc(jobs.parkedAt)).limit(50).all();
  return page(
    c,
    "Admin: sources",
    <>
      <AdminNav staging={c.env.STAGING_TOOLS === "1"} />
      <h1>Blocked and failing sources</h1>
      {list.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul class="plain">
          {list.map((s) => (
            <li>
              <span class={`pill ${s.state === "blocked" ? "bad" : ""}`}>{s.state}</span> #{s.id} {s.kind}{" "}
              {safeHref(s.url) ? <a href={safeHref(s.url)} rel="noopener noreferrer nofollow">{s.key}</a> : s.key}
              {s.lastError && <div class="meta">{s.lastError}</div>}
            </li>
          ))}
        </ul>
      )}
      <h2>Parked jobs</h2>
      {parked.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul class="plain">
          {parked.map((j) => (
            <li>
              #{j.id} {j.kind} {j.sourceId ? `source ${j.sourceId}` : j.eventId ? `event ${j.eventId}` : ""} · parked {fmtDate(j.parkedAt)}
              <div class="meta">{j.lastError}</div>
            </li>
          ))}
        </ul>
      )}
    </>,
    { noindex: true },
  );
});

adminRoutes.get("/requests", async (c) => {
  const ctx = c.get("ctx");
  const list = await ctx.db
    .select({ id: catalogRequests.id, text: catalogRequests.text, createdAt: catalogRequests.createdAt, email: users.email })
    .from(catalogRequests)
    .leftJoin(users, eq(users.id, catalogRequests.userId))
    .orderBy(desc(catalogRequests.id))
    .limit(200)
    .all();
  const counts = new Map<string, number>();
  for (const r of list) counts.set(r.text.toLowerCase(), (counts.get(r.text.toLowerCase()) ?? 0) + 1);
  return page(
    c,
    "Admin: catalog requests",
    <>
      <AdminNav staging={c.env.STAGING_TOOLS === "1"} />
      <h1>Catalog requests</h1>
      <p class="muted">Free text from the picker that matched no entry. Add the popular ones to catalog/.</p>
      {list.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ul class="plain">
          {[...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([text, n]) => (
              <li>
                <strong>{text}</strong> <span class="meta">× {n}, latest {fmtDate(list.find((r) => r.text.toLowerCase() === text)!.createdAt)}</span>
              </li>
            ))}
        </ul>
      )}
    </>,
    { noindex: true },
  );
});
