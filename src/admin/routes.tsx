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
import { Badge, Button, ButtonLink, Callout, DiffView, EmptyState, Field, PageHeader, Panel, Quote, Tabs } from "../web/ui";
import { requireAdmin, type WebContext, type WebEnv } from "../web/session";

export const adminRoutes = new Hono<WebEnv>();
adminRoutes.use("*", requireAdmin);

const STATUSES: EventStatus[] = ["pending_review", "published", "rejected", "pending_llm"];

adminRoutes.get("/", (c) => c.redirect("/admin/events"));

const AdminNav = ({ staging, current }: { staging?: boolean; current: string }) => (
  <Tabs
    label="Admin"
    items={[
      { href: "/admin/events", label: "Events" },
      { href: "/admin/sources", label: "Sources" },
      { href: "/admin/requests", label: "Requests" },
      ...(staging ? [{ href: "/admin/staging", label: "Staging" }] : []),
    ].map((t) => ({ ...t, current: t.href === current }))}
  />
);

const STATUS_TONE: Record<string, "neutral" | "ok" | "watch" | "act" | "info"> = { published: "ok", pending_review: "watch", rejected: "act", pending_llm: "info" };
const STATUS_LABELS: Record<string, string> = { pending_review: "Pending review", published: "Published", rejected: "Rejected", pending_llm: "Waiting for the LLM" };
const statusLabel = (s: string) => STATUS_LABELS[s] ?? s.replace("_", " ");

/** One event for review. Outside the queue, the note and the diff fold away so a list of published events stays scannable; `editing` is the card on its own edit page. */
const EventCard: FC<{ e: Event; csrf: string; actions?: boolean; editing?: boolean }> = ({ e, csrf, actions = true, editing }) => {
  const n = e.note as Note | null;
  const href = safeHref(e.quoteUrl);
  const fold = e.status !== "pending_review" && !editing;
  return (
    <article id={`e${e.id}`} class="panel review" aria-labelledby={`e${e.id}-h`}>
      <h2 id={`e${e.id}-h`}>
        {!editing && <span class="num">#{e.id} </span>}
        {e.title}
      </h2>
      <div class="review-meta">
        <Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{statusLabel(e.status)}</Badge>
        <Badge>{e.kind}</Badge>
        <span>{e.catalogId ?? `source ${e.sourceId}`}</span>
        <span>
          confidence <span class="num">{e.confidence?.toFixed(2) ?? "–"}</span>
        </span>
        <span>
          detected <span class="num">{new Date(e.detectedAt).toISOString().slice(0, 16).replace("T", " ")}</span>
        </span>
        {e.effectiveDate && (
          <span>
            effective <span class="num">{e.effectiveDate}</span>
          </span>
        )}
        {e.duplicateOf && <span>duplicate of #{e.duplicateOf}</span>}
      </div>
      {e.reviewReason && <p class="meta">Why: {e.reviewReason}</p>}
      {!e.quote && (
        <p class="overflow-anywhere">
          {href ? (
            <a href={href} rel="noopener noreferrer nofollow" target="_blank">
              {e.quoteUrl}
            </a>
          ) : (
            e.quoteUrl
          )}
        </p>
      )}
      {e.quote && (
        <>
          <Quote text={e.quote} size="sm" href={href ?? undefined} url={href ? undefined : e.quoteUrl} />
          <p>{e.quoteFound ? <Badge tone="ok" icon="check">Quote found in the source</Badge> : <Badge tone="act" icon="alert-triangle">Quote NOT found in the source</Badge>}</p>
        </>
      )}
      {fold ? (
        <details class="more">
          <summary>Note and source text</summary>
      {n && (
        <div class="review-note">
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
        </div>
      )}
      {(e.beforeText || e.afterText) && <DiffView before={e.beforeText} after={e.afterText} label={`Source text before and after, event #${e.id}`} />}
        </details>
      ) : (
        <>
      {n && (
        <div class="review-note">
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
        </div>
      )}
      {(e.beforeText || e.afterText) && <DiffView before={e.beforeText} after={e.afterText} label={`Source text before and after, event #${e.id}`} />}
        </>
      )}
      {actions && (
        <div class="review-actions">
          {e.status !== "published" && (
            <form class="inline" method="post" action={`/admin/events/${e.id}/approve`}>
              <Csrf token={csrf} />
              <Button variant={editing ? "secondary" : "primary"} size="sm" icon="check" disabled={!n || !e.quote}>
                {editing ? "Approve as it is" : "Approve"}
              </Button>
            </form>
          )}
          {!editing && (
            <ButtonLink size="sm" href={`/admin/events/${e.id}`}>
              Edit
            </ButtonLink>
          )}
          {e.status !== "rejected" && (
            <form class="inline" method="post" action={`/admin/events/${e.id}/reject`}>
              <Csrf token={csrf} />
              <Button variant="danger" size="sm" icon="x">
                Reject
              </Button>
            </form>
          )}
        </div>
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
      <AdminNav staging={c.env.STAGING_TOOLS === "1"} current="/admin/events" />
      <h1>{status === "pending_review" ? "Review queue" : `Events: ${statusLabel(status).toLowerCase()}`}</h1>
      <Tabs variant="segmented" label="Status" items={STATUSES.map((s) => ({ href: `/admin/events?status=${s}`, label: statusLabel(s), count: n(s), current: s === status }))} />
      <p class="meta">
        LLM, last 7 days: ${(week?.usd ?? 0).toFixed(4)} over {week?.calls ?? 0} calls; weekly budget ${budget.budget.toFixed(2)}.{" "}
        {budget.paused ? (
          <Badge tone="act">over twice the budget: classify paused, admins emailed daily</Badge>
        ) : budget.over ? (
          <Badge tone="watch">over budget: admins emailed daily; classify pauses at ${(2 * budget.budget).toFixed(2)}</Badge>
        ) : null}
      </p>
      <p class="meta">
        Alerts, last 7 days: {al.sent} sent, {al.held} held for digests, {al.suppressed} suppressed; feedback {al.useful} useful, {al.not_relevant} not relevant.
      </p>
      {flash && <Callout tone="error">{flash}</Callout>}
      {list.length === 0 ? (
        <EmptyState title="Nothing here" icon="check">
          No events with this status.
        </EmptyState>
      ) : (
        list.map((e) => <EventCard e={e} csrf={c.get("csrf")} />)
      )}
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
      <PageHeader crumbs={[{ href: "/admin/events", label: "Admin" }, { href: `/admin/events?status=${e.status}`, label: statusLabel(e.status) }]} title={`Edit event #${e.id}`} />
      <EventCard e={e} csrf={c.get("csrf")} editing />
      <Panel title="Edit and publish">
        <form method="post" action={`/admin/events/${e.id}`}>
          <Csrf token={c.get("csrf")} />
          <div class="field">
            <label for="kind">Kind</label>
            <select id="kind" name="kind">
              {EVENT_KINDS.map((k) => (
                <option value={k} selected={k === e.kind}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <Field id="title" label="Title" value={e.title} required maxlength={300} wide />
          <div class="field wide">
            <label for="what_changed">What changed</label>
            <textarea id="what_changed" name="what_changed" rows={4} required>
              {n?.what_changed ?? ""}
            </textarea>
          </div>
          <div class="field wide">
            <label for="quote">Quote (verbatim from the source)</label>
            <textarea id="quote" name="quote" rows={4} required>
              {e.quote ?? ""}
            </textarea>
          </div>
          <Field id="effective_date" label="Effective date" hint="YYYY-MM-DD or YYYY-MM" value={e.effectiveDate ?? ""} pattern="\d{4}-\d{2}(-\d{2})?" />
          <Button variant="primary">Save and publish</Button>
        </form>
      </Panel>
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
      <AdminNav staging={c.env.STAGING_TOOLS === "1"} current="/admin/sources" />
      <h1>Blocked and failing sources</h1>
      {list.length === 0 ? (
        <EmptyState title="No blocked or failing sources" icon="check" level={2} />
      ) : (
        <ul class="plain panel">
          {list.map((s) => (
            <li>
              {s.state === "blocked" ? <Badge tone="act">blocked</Badge> : <Badge tone="watch">failing</Badge>}{" "}
              {safeHref(s.url) ? <a href={safeHref(s.url)} rel="noopener noreferrer nofollow" class="overflow-anywhere">{s.url}</a> : <code>{s.key}</code>}{" "}
              <span class="meta">
                <span class="num">#{s.id}</span> {s.kind}
              </span>
              {s.lastError && <div class="meta">{s.lastError}</div>}
            </li>
          ))}
        </ul>
      )}
      <h2>Parked jobs</h2>
      {parked.length === 0 ? (
        <EmptyState title="No parked jobs" icon="check" level={3} />
      ) : (
        <ul class="plain panel">
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
      <AdminNav staging={c.env.STAGING_TOOLS === "1"} current="/admin/requests" />
      <h1>Catalog requests</h1>
      <p class="muted">Free text from the picker that matched no entry. Add the popular ones to catalog/.</p>
      {list.length === 0 ? (
        <EmptyState title="No requests yet" icon="inbox" />
      ) : (
        <ul class="plain panel">
          {[...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([text, n]) => (
              <li>
                {/* Grouped case-insensitively; shown as the newest request spelled it. */}
                <strong>{list.find((r) => r.text.toLowerCase() === text)!.text}</strong> <span class="meta">× {n}, latest <time>{fmtDate(list.find((r) => r.text.toLowerCase() === text)!.createdAt)}</time></span>
              </li>
            ))}
        </ul>
      )}
    </>,
    { noindex: true },
  );
});
