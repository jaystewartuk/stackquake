// Public pages (SPEC §7.6): landing, catalog, events and the RSS feed. Only `published` events
// are ever shown here.
import { Hono } from "hono";
import type { CatalogEntry } from "../catalog/catalog";
import { CATALOG } from "../catalog/entries";
import type { Note } from "../llm/schemas";
import { catalogEntry, CATEGORY_LABELS, groupByCategory, searchCatalog } from "./catalog-view";
import { EventList, KIND_LABELS, KindPill, latestByCatalog, NoteView, noteFacts, publishedEvent, publishedEvents, subjectName, type PublicEvent } from "./events-view";
import { Icon, type IconName } from "./icons";
import { fmtDate, page, safeHref } from "./layout";
import { appOrigin, type WebContext, type WebEnv } from "./session";
import { Button, ButtonLink, DataList, EmptyState, InputGroup, PageHeader, Panel, Trace } from "./ui";

export const pub = new Hono<WebEnv>();

const PAGE_SIZE = 30;

/** "Blog · 2 pages · End-of-life dates": what we read for an entry, in a few words. */
function watchedSummary(e: CatalogEntry): string[] {
  const n = (k: string) => e.sources.filter((s) => s.kind === k).length;
  const parts = [
    n("feed") && "Blog",
    n("page") && (n("page") === 1 ? "1 page" : `${n("page")} pages`),
    n("npm") && "npm",
    n("pypi") && "PyPI",
    n("github_repo") && "GitHub repo",
    n("eol") && "End-of-life dates",
  ].filter((x): x is string => !!x);
  return parts;
}

pub.get("/catalog", async (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 100);
  const groups = groupByCategory(searchCatalog(q));
  const latest = await latestByCatalog(c.get("ctx"));
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  return page(
    c,
    "Catalog",
    <>
      <PageHeader
        title="What Stackquake watches"
        description={`${CATALOG.length} services, runtimes and tools in ${groupByCategory(CATALOG).length} categories. For each we read the vendor's announcements, pricing and limits pages, licences and end-of-life dates.`}
      />
      <div class="catalog-tools">
        <form method="get" action="/catalog" role="search" aria-label="Catalog">
          <InputGroup>
            <input type="search" name="q" value={q} placeholder="Search, e.g. Supabase" aria-label="Search the catalog" />
            <Button icon="search">Search</Button>
          </InputGroup>
        </form>
        {q && groups.length > 0 && (
          <p class="meta" role="status">
            {shown} of {CATALOG.length} match “{q}”. <a href="/catalog">Show everything</a>
          </p>
        )}
        {groups.length > 1 && (
          <nav class="cat-nav" aria-label="Categories">
            {groups.map((g) => (
              <a href={`#cat-${g.category}`}>
                {g.label} <span class="num">{g.entries.length}</span>
              </a>
            ))}
          </nav>
        )}
      </div>
      {groups.length === 0 && (
        <EmptyState
          icon="search"
          title={`Nothing matches “${q}”`}
          actions={
            <>
              <ButtonLink href="/catalog">Show everything</ButtonLink>
              <ButtonLink href="/signin?next=/app/projects/new" variant="quiet">
                Sign in to request it
              </ButtonLink>
            </>
          }
        >
          We don't watch it yet. Signed-in users can ask for it from the service picker.
        </EmptyState>
      )}
      {groups.map((g) => (
        <section class="cat-group" id={`cat-${g.category}`} aria-labelledby={`cat-${g.category}-h`}>
          <h2 id={`cat-${g.category}-h`}>
            {g.label} <span class="count-label num">{g.entries.length}</span>
          </h2>
          <ul class="entry-grid">
            {g.entries.map((e) => {
              const l = latest.get(e.id);
              return (
                <li class="entry-card">
                  <a class="entry-name" href={`/catalog/${e.id}`}>
                    {e.name}
                    {/* A two-letter name ("Go") reads as a generic link out of context; the category disambiguates it. */}
                    {e.name.length < 4 && <span class="visually-hidden"> ({g.label})</span>}
                  </a>
                  <span class="entry-watch dots">
                    {watchedSummary(e).map((w) => (
                      <>
                        <span>{w}</span>{" "}
                      </>
                    ))}
                  </span>
                  {l ? (
                    <span class="entry-latest">
                      <KindPill kind={l.latest.kind} />
                      <time datetime={fmtDate(l.latest.publishedAt)}>{fmtDate(l.latest.publishedAt)}</time>
                      {l.count > 1 && <span>+{l.count - 1} earlier</span>}
                    </span>
                  ) : (
                    <span class="entry-latest none">No changes published yet</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>,
    { description: "The services, runtimes and tools Stackquake watches for pricing, licence and end-of-life changes." },
  );
});

const SOURCE_LABELS: Record<string, string> = { feed: "Blog / changelog feed", page: "Page", npm: "npm package", pypi: "PyPI package", github_repo: "GitHub repository", eol: "End-of-life dates" };
const SOURCE_ICONS: Record<string, IconName> = { feed: "rss", page: "layers", npm: "inbox", pypi: "inbox", github_repo: "github", eol: "clock" };

function sourceTarget(s: CatalogSourceSpec): { label: string; href?: string } {
  switch (s.kind) {
    case "feed":
    case "page":
      return { label: s.url.replace(/^https?:\/\/(www\.)?/, ""), href: s.url };
    case "npm":
      return { label: s.package, href: `https://www.npmjs.com/package/${s.package}` };
    case "pypi":
      return { label: s.package, href: `https://pypi.org/project/${s.package}/` };
    case "github_repo":
      return { label: s.repo, href: `https://github.com/${s.repo}` };
    case "eol":
      return { label: s.product, href: `https://endoflife.date/${s.product}` };
  }
}
type CatalogSourceSpec = (typeof CATALOG)[number]["sources"][number];

const startHref = (c: WebContext) => (c.get("user") ? "/app" : "/signin?next=/app/projects/new");

pub.get("/catalog/:id", async (c) => {
  const entry = catalogEntry(c.req.param("id"));
  if (!entry) return c.notFound();
  const recent = await publishedEvents(c.get("ctx"), { limit: 20, catalogId: entry.id });
  const alts = (entry.alternatives ?? []).map((id) => catalogEntry(id) ?? { id, name: id, missing: true });
  return page(
    c,
    `${entry.name}: pricing, licence and end-of-life changes`,
    <>
      <PageHeader
        crumbs={[
          { href: "/catalog", label: "Catalog" },
          { href: `/catalog#cat-${entry.category}`, label: CATEGORY_LABELS[entry.category] },
        ]}
        title={entry.name}
        description={`Pricing, free-tier, licence and end-of-life changes for ${entry.name}, each quoting its source.`}
        actions={
          <ButtonLink variant="primary" href={startHref(c)} iconEnd="arrow-right" block>
            Get alerts for {entry.name}
          </ButtonLink>
        }
      />
      <div class="split">
        <section aria-labelledby="recent-h">
          <h2 id="recent-h">Recent changes</h2>
          {recent.length ? (
            <EventList events={recent} subject={false} />
          ) : (
            <EmptyState icon="check" title="No published changes yet" level={3}>
              We'll note the next one here, and email you if you watch {entry.name}.
            </EmptyState>
          )}
        </section>
        <aside class="rail" aria-label={`About ${entry.name}`}>
          <Panel title="What we watch" level={2}>
            <ul class="source-list">
              {entry.sources.map((s) => {
                const t = sourceTarget(s);
                const href = safeHref(t.href);
                return (
                  <li>
                    <Icon name={SOURCE_ICONS[s.kind] ?? "info"} />
                    <span>
                      <span class="source-kind">{SOURCE_LABELS[s.kind]}</span>
                      {href ? (
                        <a href={href} rel="noopener noreferrer nofollow">
                          {t.label}
                        </a>
                      ) : (
                        t.label
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
          {alts.length > 0 && (
            <Panel title="Alternatives" level={2}>
              <p class="chips">
                {alts.map((a) => ("missing" in a ? <span class="chip">{a.name}</span> : <a class="chip" href={`/catalog/${a.id}`}>{a.name}</a>))}
              </p>
            </Panel>
          )}
        </aside>
      </div>
    </>,
    { description: `Pricing, free-tier, licence and end-of-life changes for ${entry.name}, quoted from the source.` },
  );
});

const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (ms: number | null) => {
  const d = new Date(ms ?? 0);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** The public feed's last 90 days as a trace: one spike per published change, each linking to it. */
export async function feedTrace(c: WebContext, label: string) {
  const now = c.get("ctx").clock.now();
  const from = now - 90 * DAY;
  const list = await publishedEvents(c.get("ctx"), { limit: 60 });
  const points = list.filter((e) => (e.publishedAt ?? 0) >= from).map((e) => ({ at: e.publishedAt ?? 0, level: "kind" as const, label: `${subjectName(e)}: ${e.title} (${fmtDate(e.publishedAt)})`, href: `/events/${e.id}` }));
  return { points, node: <Trace points={points} from={from} to={now} height={40} label={`${label}: ${points.length} published changes in the last 90 days`} axis={["90 days ago", "today"]} /> };
}

pub.get("/events", async (c) => {
  const before = Number(c.req.query("before") ?? "") || undefined;
  const list = await publishedEvents(c.get("ctx"), { limit: PAGE_SIZE + 1, before });
  const more = list.length > PAGE_SIZE ? list[PAGE_SIZE - 1].publishedAt : null;
  const shown = list.slice(0, PAGE_SIZE);
  const months: { label: string; events: PublicEvent[] }[] = [];
  for (const e of shown) {
    const label = monthOf(e.publishedAt);
    if (months.at(-1)?.label !== label) months.push({ label, events: [] });
    months.at(-1)!.events.push(e);
  }
  const trace = before ? null : await feedTrace(c, "Published changes");
  return page(
    c,
    "Events",
    <>
      <PageHeader
        title="Changes we've seen"
        description="Licence, pricing, free-tier and end-of-life changes to developer services and runtimes, each quoting its source."
        actions={
          <ButtonLink href="/events.rss" icon="rss" size="sm">
            RSS feed
          </ButtonLink>
        }
      />
      {trace && trace.points.length > 0 && <div class="feed-trace">{trace.node}</div>}
      {shown.length === 0 ? (
        <EmptyState icon="inbox" title="Nothing published yet">
          Changes appear here once a note has been checked against its source.
        </EmptyState>
      ) : (
        months.map((m) => (
          <section class="month" aria-label={m.label}>
            <h2 class="month-h">{m.label}</h2>
            <EventList events={m.events} />
          </section>
        ))
      )}
      {more && (
        <p>
          <ButtonLink href={`/events?before=${more}`} iconEnd="arrow-right">
            Older changes
          </ButtonLink>
        </p>
      )}
    </>,
    { description: "Recent licence, pricing, free-tier and end-of-life changes for developer services and runtimes, each quoting its source." },
  );
});

pub.get("/events/:id{[0-9]+}", async (c) => {
  const e = await publishedEvent(c.get("ctx"), Number(c.req.param("id")));
  if (!e) return c.notFound();
  const entry = catalogEntry(e.catalogId);
  const n = e.note as Note | null;
  const subject = subjectName(e);
  const url = `${appOrigin(c)}/events/${e.id}`;
  const description = n?.what_changed ? (n.what_changed.length > 200 ? `${n.what_changed.slice(0, 197).replace(/\s+\S*$/, "")}…` : n.what_changed) : `${KIND_LABELS[e.kind]} change: ${e.title}`;
  return page(
    c,
    `${subject}: ${e.title}`,
    <>
      <PageHeader
        crumbs={[{ href: "/events", label: "Events" }, ...(entry ? [{ href: `/catalog/${entry.id}`, label: entry.name }] : [])]}
        kicker={
          <>
            <KindPill kind={e.kind} /> <span class="kicker-subject">{entry ? <a href={`/catalog/${entry.id}`}>{subject}</a> : subject}</span>
          </>
        }
        title={e.title}
        description={n?.what_changed}
      />
      <div class="split note-split">
        <div>
          <DataList strip label="Facts" items={noteFacts(e)} />
          <NoteView e={e} />
        </div>
        <aside class="rail" aria-label="Get alerts and share">
          <Panel title="Get this for your stack" level={2}>
            <p class="muted">Pick what you run on and we'll email you, once, when a change like this affects you.</p>
            <ButtonLink variant="primary" iconEnd="arrow-right" href={startHref(c)} block>
              Pick what you run on
            </ButtonLink>
          </Panel>
          <Panel title="Share this note" level={2}>
            <label for="permalink">Link to this note</label>
            <input type="url" id="permalink" value={url} readonly />
            <p class="meta">
              <a href="/events.rss">
                <Icon name="rss" /> Every change by RSS
              </a>
            </p>
          </Panel>
        </aside>
      </div>
    </>,
    {
      description,
      ogType: "article",
      head: <meta property="article:published_time" content={new Date(e.publishedAt ?? 0).toISOString()} />,
    },
  );
});

const xml = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);

pub.get("/events.rss", async (c) => {
  const origin = appOrigin(c);
  const list = await publishedEvents(c.get("ctx"), { limit: 50 });
  const items = list
    .map((e) => {
      const n = e.note as Note | null;
      const desc = [n?.what_changed, e.quote ? `“${e.quote}”` : null, `Source: ${e.quoteUrl}`, "Summary, not legal advice; read the source."].filter(Boolean).join("\n\n");
      return `<item><title>${xml(`${subjectName(e)}: ${e.title}`)}</title><link>${origin}/events/${e.id}</link><guid isPermaLink="true">${origin}/events/${e.id}</guid><pubDate>${new Date(e.publishedAt ?? 0).toUTCString()}</pubDate><category>${xml(KIND_LABELS[e.kind] ?? e.kind)}</category><description>${xml(desc)}</description></item>`;
    })
    .join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Stackquake: changes to developer services</title><link>${origin}/events</link><description>Licence, pricing, free-tier and end-of-life changes, quoted from the source.</description>${items}</channel></rss>`;
  return c.body(body, 200, { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" });
});
