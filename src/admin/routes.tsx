// /admin (SPEC §7.3 step 4, §7.6): the review queue. Minimal server-rendered pages: list events
// waiting for review with their quote, before/after text and source link; approve, edit or
// reject each in one click. Everything fetched is rendered as text (JSX escapes it) and links
// are only rendered for http(s) URLs.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { FC, PropsWithChildren } from "hono/jsx";
import { EVENT_KINDS, events, llmCalls, type Event, type EventKind, type EventStatus } from "../db/schema";
import { makeCtx, type AppEnv } from "../env";
import type { Note } from "../llm/schemas";
import { getText } from "../pipeline/post";
import { quoteFound } from "../pipeline/quote";
import { DAY } from "../util";
import { checkSession, csrfToken, makeSession, safeEqual, SESSION_COOKIE, SESSION_MS } from "./auth";

type Env = { Bindings: AppEnv; Variables: { csrf: string } };
export const adminRoutes = new Hono<Env>();

const STATUSES: EventStatus[] = ["pending_review", "published", "rejected", "pending_llm"];
const safeHref = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : undefined);

const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{title} · Stackquake admin</title>
      <style>{`
        body{font:15px/1.45 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1rem;color:#1a1a1a;background:#fafaf8}
        h1{font-size:1.3rem} h2{font-size:1.05rem;margin:.2rem 0}
        nav a{margin-right:1rem} .meta{color:#555;font-size:.85rem}
        article{background:#fff;border:1px solid #ddd;border-radius:6px;padding:.8rem 1rem;margin:1rem 0}
        blockquote{margin:.5rem 0;padding:.3rem .8rem;border-left:3px solid #999;background:#f4f4f0;white-space:pre-wrap}
        pre{white-space:pre-wrap;word-break:break-word;background:#f6f6f6;padding:.5rem;max-height:16rem;overflow:auto;font-size:.8rem}
        .cols{display:grid;grid-template-columns:1fr 1fr;gap:.5rem} .bad{color:#a00} .ok{color:#070}
        form.inline{display:inline} button{margin-right:.4rem;padding:.3rem .8rem}
        label{display:block;margin:.5rem 0 .2rem;font-weight:600} input[type=text],textarea,select{width:100%;box-sizing:border-box;font:inherit}
        textarea{min-height:5rem}
      `}</style>
    </head>
    <body>{children}</body>
  </html>
);

async function adminSecret(c: Context<Env>): Promise<string | null> {
  return c.env.ADMIN_TOKEN && c.env.ADMIN_TOKEN.length >= 16 ? c.env.ADMIN_TOKEN : null;
}

adminRoutes.use("*", async (c, next) => {
  const secret = await adminSecret(c);
  if (!secret) return c.text("Admin is not configured (set ADMIN_TOKEN, at least 16 characters).", 503);
  const path = new URL(c.req.url).pathname;
  if (path === "/admin/login") return next();
  const exp = await checkSession(secret, getCookie(c, SESSION_COOKIE), Date.now());
  if (exp === null) return c.req.method === "GET" ? c.redirect("/admin/login") : c.text("Not signed in", 401);
  const csrf = await csrfToken(secret, exp);
  if (c.req.method === "POST") {
    const form = await c.req.parseBody();
    if (typeof form._csrf !== "string" || !safeEqual(form._csrf, csrf)) return c.text("Bad CSRF token", 403);
  }
  c.set("csrf", csrf);
  await next();
});

adminRoutes.get("/login", (c) =>
  c.html(
    <Layout title="Sign in">
      <h1>Stackquake admin</h1>
      <form method="post" action="/admin/login">
        <label for="token">Admin token</label>
        <input type="password" id="token" name="token" autocomplete="current-password" required />
        <p>
          <button type="submit">Sign in</button>
        </p>
      </form>
    </Layout>,
  ),
);

adminRoutes.post("/login", async (c) => {
  const secret = (await adminSecret(c))!;
  const form = await c.req.parseBody();
  if (typeof form.token !== "string" || !safeEqual(form.token, secret)) return c.text("Wrong token", 401);
  setCookie(c, SESSION_COOKIE, await makeSession(secret, Date.now()), { httpOnly: true, secure: true, sameSite: "Strict", path: "/admin", maxAge: SESSION_MS / 1000 });
  return c.redirect("/admin/events");
});

adminRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/admin", secure: true });
  return c.redirect("/admin/login");
});

adminRoutes.get("/", (c) => c.redirect("/admin/events"));

const Csrf: FC<{ token: string }> = ({ token }) => <input type="hidden" name="_csrf" value={token} />;

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
  const ctx = makeCtx(c.env);
  const status = (STATUSES as string[]).includes(c.req.query("status") ?? "") ? (c.req.query("status") as EventStatus) : "pending_review";
  const list = await ctx.db.select().from(events).where(eq(events.status, status)).orderBy(desc(events.detectedAt)).limit(50).all();
  const counts = await ctx.db.select({ status: events.status, n: sql<number>`count(*)` }).from(events).groupBy(events.status).all();
  const week = await ctx.db
    .select({ usd: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`, calls: sql<number>`count(*)` })
    .from(llmCalls)
    .where(gt(llmCalls.createdAt, Date.now() - 7 * DAY))
    .get();
  const n = (s: string) => counts.find((r) => r.status === s)?.n ?? 0;
  const flash = c.req.query("msg");
  return c.html(
    <Layout title="Events">
      <h1>Events: {status.replace("_", " ")}</h1>
      <nav>
        {STATUSES.map((s) => (
          <a href={`/admin/events?status=${s}`}>
            {s.replace("_", " ")} ({n(s)})
          </a>
        ))}
      </nav>
      <p class="meta">
        LLM, last 7 days: ${(week?.usd ?? 0).toFixed(4)} over {week?.calls ?? 0} calls.{" "}
        <form class="inline" method="post" action="/admin/logout">
          <Csrf token={c.get("csrf")} />
          <button type="submit">Sign out</button>
        </form>
      </p>
      {flash && <p class="bad">{flash}</p>}
      {list.length === 0 ? <p>Nothing here.</p> : list.map((e) => <EventCard e={e} csrf={c.get("csrf")} />)}
    </Layout>,
  );
});

async function loadEvent(c: Context<Env>): Promise<Event | undefined> {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return undefined;
  return makeCtx(c.env).db.select().from(events).where(eq(events.id, id)).get();
}

adminRoutes.post("/events/:id/approve", async (c) => {
  const e = await loadEvent(c);
  if (!e) return c.notFound();
  if (!e.note || !e.quote) return c.redirect(`/admin/events?msg=${encodeURIComponent(`#${e.id} has no note or quote: edit it first`)}`);
  await makeCtx(c.env)
    .db.update(events)
    .set({ status: "published", publishedAt: Date.now(), reviewReason: `approved by admin${e.reviewReason ? ` (was: ${e.reviewReason})` : ""}`.slice(0, 1_000) })
    .where(eq(events.id, e.id));
  return c.redirect("/admin/events");
});

adminRoutes.post("/events/:id/reject", async (c) => {
  const e = await loadEvent(c);
  if (!e) return c.notFound();
  await makeCtx(c.env)
    .db.update(events)
    .set({ status: "rejected", publishedAt: null, reviewReason: `rejected by admin${e.reviewReason ? ` (was: ${e.reviewReason})` : ""}`.slice(0, 1_000) })
    .where(and(eq(events.id, e.id)));
  return c.redirect("/admin/events");
});

adminRoutes.get("/events/:id", async (c) => {
  const e = await loadEvent(c);
  if (!e) return c.notFound();
  const n = e.note as Note | null;
  return c.html(
    <Layout title={`Edit #${e.id}`}>
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
    </Layout>,
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
  const ctx = makeCtx(c.env);
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
      publishedAt: Date.now(),
      reviewReason: "edited and approved by admin",
    })
    .where(eq(events.id, e.id));
  return c.redirect("/admin/events");
});
