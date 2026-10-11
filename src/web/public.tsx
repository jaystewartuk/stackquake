// Public pages (SPEC §7.6): landing, catalog, events and the RSS feed. Only `published` events
// are ever shown here.
import { Hono } from "hono";
import { CATALOG } from "../catalog/entries";
import type { Note } from "../llm/schemas";
import { catalogEntry, CATEGORY_LABELS, groupByCategory, searchCatalog } from "./catalog-view";
import { EventRow, KIND_LABELS, NoteView, publishedEvent, publishedEvents, subjectName } from "./events-view";
import { page, safeHref } from "./layout";
import { appOrigin, type WebEnv } from "./session";

export const pub = new Hono<WebEnv>();

const PAGE_SIZE = 30;

pub.get("/catalog", (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 100);
  const groups = groupByCategory(searchCatalog(q));
  return page(
    c,
    "Catalog",
    <>
      <h1>What Stackquake watches</h1>
      <p class="muted">
        {CATALOG.length} services, runtimes and tools. For each we watch the vendor's announcements, pricing and limits pages, licences and end-of-life dates.
      </p>
      <form method="get" action="/catalog" class="row">
        <input type="search" name="q" value={q} placeholder="Search by name, e.g. Supabase or workers" aria-label="Search the catalog" style="max-width:24rem" />
        <button type="submit">Search</button>
      </form>
      {groups.length === 0 && <p>Nothing matches “{q}”. Sign in and add it from the picker to request it.</p>}
      {groups.map((g) => (
        <>
          <h2>{g.label}</h2>
          <div class="grid">
            {g.entries.map((e) => (
              <a class="card" href={`/catalog/${e.id}`} style="margin:0;text-decoration:none">
                <strong>{e.name}</strong>
                <div class="meta">{e.sources.length} sources watched</div>
              </a>
            ))}
          </div>
        </>
      ))}
    </>,
    { description: "The services, runtimes and tools Stackquake watches for pricing, licence and end-of-life changes." },
  );
});

const SOURCE_LABELS: Record<string, string> = { feed: "Blog / changelog feed", page: "Page", npm: "npm package", pypi: "PyPI package", github_repo: "GitHub repository", eol: "End-of-life dates" };

function sourceTarget(s: CatalogSourceSpec): { label: string; href?: string } {
  switch (s.kind) {
    case "feed":
    case "page":
      return { label: s.url, href: s.url };
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

pub.get("/catalog/:id", async (c) => {
  const entry = catalogEntry(c.req.param("id"));
  if (!entry) return c.notFound();
  const recent = await publishedEvents(c.get("ctx"), { limit: 20, catalogId: entry.id });
  const alts = (entry.alternatives ?? []).map((id) => catalogEntry(id) ?? { id, name: id, missing: true });
  return page(
    c,
    entry.name,
    <>
      <p class="meta">
        <a href="/catalog">Catalog</a> · {CATEGORY_LABELS[entry.category]}
      </p>
      <h1>{entry.name}: pricing, licence and end-of-life changes</h1>
      <h2>Recent changes</h2>
      {recent.length ? (
        <ul class="plain">
          {recent.map((e) => (
            <EventRow e={e} />
          ))}
        </ul>
      ) : (
        <p class="muted">No published changes yet. We'll note the next one here.</p>
      )}
      <h2>What we watch</h2>
      <ul>
        {entry.sources.map((s) => {
          const t = sourceTarget(s);
          const href = safeHref(t.href);
          return (
            <li>
              {SOURCE_LABELS[s.kind]}: {href ? <a href={href} rel="noopener noreferrer nofollow">{t.label}</a> : t.label}
            </li>
          );
        })}
      </ul>
      {alts.length > 0 && (
        <>
          <h2>Alternatives</h2>
          <p>
            {alts.map((a, i) => (
              <>
                {i > 0 && " · "}
                {"missing" in a ? a.name : <a href={`/catalog/${a.id}`}>{a.name}</a>}
              </>
            ))}
          </p>
        </>
      )}
      <p>
        <a class="btn primary" href={c.get("user") ? "/app" : "/signin?next=/app/projects/new"}>
          Get alerts for {entry.name}
        </a>
      </p>
    </>,
    { description: `Pricing, free-tier, licence and end-of-life changes for ${entry.name}, quoted from the source.` },
  );
});

pub.get("/events", async (c) => {
  const before = Number(c.req.query("before") ?? "") || undefined;
  const list = await publishedEvents(c.get("ctx"), { limit: PAGE_SIZE + 1, before });
  const more = list.length > PAGE_SIZE ? list[PAGE_SIZE - 1].publishedAt : null;
  return page(
    c,
    "Events",
    <>
      <div class="spread">
        <h1>Changes we've seen</h1>
        <a href="/events.rss" class="meta">
          RSS
        </a>
      </div>
      <p class="muted">Licence, pricing, free-tier and end-of-life changes, each quoting its source.</p>
      {list.length === 0 ? (
        <p>Nothing published yet.</p>
      ) : (
        <ul class="plain">
          {list.slice(0, PAGE_SIZE).map((e) => (
            <EventRow e={e} />
          ))}
        </ul>
      )}
      {more && (
        <p>
          <a href={`/events?before=${more}`}>Older</a>
        </p>
      )}
    </>,
    { description: "Recent licence, pricing, free-tier and end-of-life changes for developer services and runtimes." },
  );
});

pub.get("/events/:id{[0-9]+}", async (c) => {
  const e = await publishedEvent(c.get("ctx"), Number(c.req.param("id")));
  if (!e) return c.notFound();
  const entry = catalogEntry(e.catalogId);
  const n = e.note as Note | null;
  return page(
    c,
    `${subjectName(e)}: ${e.title}`,
    <>
      <p class="meta">
        <a href="/events">Events</a>
        {entry && (
          <>
            {" · "}
            <a href={`/catalog/${entry.id}`}>{entry.name}</a>
          </>
        )}
      </p>
      <h1>
        {subjectName(e)}: {e.title}
      </h1>
      <NoteView e={e} />
      <p>
        <a class="btn primary" href={c.get("user") ? "/app" : "/signin?next=/app/projects/new"}>
          Get alerts when your stack changes
        </a>
      </p>
    </>,
    { description: n?.what_changed?.slice(0, 200) ?? `${KIND_LABELS[e.kind]} change: ${e.title}` },
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
