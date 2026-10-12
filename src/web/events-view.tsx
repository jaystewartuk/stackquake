// Published events as shown to users: lists, the full note, and the subject's display name.
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { FC } from "hono/jsx";
import type { Ctx } from "../context";
import { catalogSources, events, sources, type Event } from "../db/schema";
import type { Note } from "../llm/schemas";
import { catalogEntry } from "./catalog-view";
import { Icon, type IconName } from "./icons";
import { fmtDate, safeHref } from "./layout";
import { Badge, OptionCard, Quote } from "./ui";

export type PublicEvent = Pick<Event, "id" | "kind" | "title" | "publishedAt" | "effectiveDate" | "catalogId" | "quote" | "quoteUrl" | "note"> & { sourceKind: string; sourceKey: string };

const cols = {
  id: events.id,
  kind: events.kind,
  title: events.title,
  publishedAt: events.publishedAt,
  effectiveDate: events.effectiveDate,
  catalogId: events.catalogId,
  quote: events.quote,
  quoteUrl: events.quoteUrl,
  note: events.note,
  sourceKind: sources.kind,
  sourceKey: sources.key,
};

/** Newest published first. `before` pages by publication time. */
export async function publishedEvents(ctx: Ctx, opts: { limit: number; before?: number; catalogId?: string; sourceIds?: number[] }): Promise<PublicEvent[]> {
  const conds = [eq(events.status, "published")];
  if (opts.before) conds.push(lt(events.publishedAt, opts.before));
  if (opts.catalogId) {
    // An entry's events: tagged with it, or from one of its sources.
    conds.push(sql`(${events.catalogId} = ${opts.catalogId} OR ${events.sourceId} IN (SELECT ${catalogSources.sourceId} FROM ${catalogSources} WHERE ${catalogSources.catalogId} = ${opts.catalogId}))`);
  }
  if (opts.sourceIds) {
    if (!opts.sourceIds.length) return [];
    conds.push(inArray(events.sourceId, opts.sourceIds));
  }
  return ctx.db
    .select(cols)
    .from(events)
    .innerJoin(sources, eq(sources.id, events.sourceId))
    .where(and(...conds))
    .orderBy(desc(events.publishedAt), desc(events.id))
    .limit(opts.limit)
    .all();
}

export async function publishedEvent(ctx: Ctx, id: number): Promise<PublicEvent | undefined> {
  return ctx.db
    .select(cols)
    .from(events)
    .innerJoin(sources, eq(sources.id, events.sourceId))
    .where(and(eq(events.id, id), eq(events.status, "published")))
    .get();
}

/** "Deno", or the package/repo the event came from when it is not tied to one catalog entry. */
export function subjectName(e: Pick<PublicEvent, "catalogId" | "sourceKind" | "sourceKey">): string {
  const entry = catalogEntry(e.catalogId);
  if (entry) return entry.name;
  if (e.sourceKind === "npm" || e.sourceKind === "pypi") return `${e.sourceKey} (${e.sourceKind})`;
  if (e.sourceKind === "github_repo") return e.sourceKey;
  if (e.sourceKind === "eol") return e.sourceKey.replace("@", " ");
  try {
    return new URL(e.sourceKey.split(" ")[0]).host;
  } catch {
    return e.sourceKey;
  }
}

export const KIND_LABELS: Record<string, string> = {
  license: "Licence",
  eol: "End of life",
  acquisition: "Acquisition",
  pricing: "Pricing",
  free_tier: "Free tier",
  deprecated: "Deprecated",
  archived: "Archived",
  other: "Other",
};

/** Kinds that need action when they affect you (DIRECTION.md "Severity mapping"). */
export const URGENT = new Set(["license", "eol", "acquisition", "free_tier"]);

const KIND_ICONS: Record<string, IconName> = { license: "shield", eol: "clock", acquisition: "users", pricing: "calendar", free_tier: "calendar", deprecated: "alert-triangle", archived: "inbox" };

/** An event's kind: neutral, with an icon. Severity is about the user, so it is shown separately. */
export const KindPill: FC<{ kind: string }> = ({ kind }) => <Badge icon={KIND_ICONS[kind] ?? "info"}>{KIND_LABELS[kind] ?? kind}</Badge>;

/** "Took effect" once an effective date ("2026-04-30" or "2027-10") is behind us, else "Takes effect". */
export function effectLabel(date: string, now = Date.now()): string {
  return `${date}-99`.slice(0, 10) < fmtDate(now) ? "Took effect" : "Takes effect";
}

/** The title with the subject in front, unless the title already starts with it ("Deno: Deno runtime…"). */
const titleHasSubject = (subject: string, title: string) => title.toLowerCase().startsWith(subject.toLowerCase());

/** One change in a list: date in the margin, kind, subject and title, the one-paragraph summary. `subject={false}` on a page about that subject. */
export const EventRow: FC<{ e: PublicEvent; summary?: boolean; subject?: boolean }> = ({ e, summary = true, subject = true }) => {
  const n = e.note as Note | null;
  const name = subjectName(e);
  return (
    <li class="event-row">
      <time class="er-date" datetime={fmtDate(e.publishedAt)}>
        {fmtDate(e.publishedAt)}
      </time>
      <div class="er-body">
        <a class="er-title" href={`/events/${e.id}`}>
          {subject && !titleHasSubject(name, e.title) && <><strong>{name}</strong>: </>}
          {e.title}
        </a>
        <div class="er-meta">
          <KindPill kind={e.kind} />
          {e.effectiveDate && (
            <span>
              {effectLabel(e.effectiveDate)} <span class="num">{e.effectiveDate}</span>
            </span>
          )}
        </div>
        {summary && n?.what_changed && <p class="er-summary">{n.what_changed}</p>}
      </div>
    </li>
  );
};

export const EventList: FC<{ events: PublicEvent[]; summary?: boolean; subject?: boolean }> = ({ events: list, summary, subject }) => (
  <ul class="event-list">
    {list.map((e) => (
      <EventRow e={e} summary={summary} subject={subject} />
    ))}
  </ul>
);

/** The newest published change and the count per catalog entry, for the catalog's cards. */
export async function latestByCatalog(ctx: Ctx): Promise<Map<string, { latest: Pick<Event, "id" | "kind" | "title" | "publishedAt">; count: number }>> {
  const rows = await ctx.db
    .select({ id: events.id, kind: events.kind, title: events.title, publishedAt: events.publishedAt, catalogId: events.catalogId })
    .from(events)
    .where(and(eq(events.status, "published"), isNotNull(events.catalogId)))
    .orderBy(desc(events.publishedAt), desc(events.id))
    .limit(500)
    .all();
  const out = new Map<string, { latest: Pick<Event, "id" | "kind" | "title" | "publishedAt">; count: number }>();
  for (const { catalogId, ...r } of rows) {
    const cur = out.get(catalogId!);
    if (cur) cur.count++;
    else out.set(catalogId!, { latest: r, count: 1 });
  }
  return out;
}

const HOSTING_WORDS: Record<string, string> = { hosted: "the hosted service", self_hosted: "a self-hosted install" };
const USE_WORDS: Record<string, string> = { commercial: "commercial use", personal: "personal use" };
const TIER_WORDS: Record<string, string> = { free: "the free tier", paid: "a paid plan" };
const orList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** "Who is affected", in plain words, from the note's applies_when (public pages have no user to match). */
export function whoIsAffected(n: Note, subject: string): string {
  const a = n.applies_when ?? { hosting: [], use: [], tier: [] };
  const parts = [
    a.hosting.length ? `on ${orList(a.hosting.map((h) => HOSTING_WORDS[h] ?? h))}` : null,
    a.use.length ? `for ${orList(a.use.map((u) => USE_WORDS[u] ?? u))}` : null,
    a.tier.length ? `on ${orList(a.tier.map((t) => TIER_WORDS[t] ?? t))}` : null,
  ].filter(Boolean);
  return parts.length ? `You're affected if you use ${subject} ${parts.join(", ")}.` : `This affects everyone who uses ${subject}, however you use it.`;
}

const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).host.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

/** The note's facts, for the strip under the title. */
export function noteFacts(e: PublicEvent) {
  const href = safeHref(e.quoteUrl);
  return [
    { term: "Published", value: <time datetime={fmtDate(e.publishedAt)}>{fmtDate(e.publishedAt)}</time> },
    ...(e.effectiveDate ? [{ term: effectLabel(e.effectiveDate), value: e.effectiveDate, highlight: true }] : []),
    ...(href ? [{ term: "Source", value: <a href={href} rel="noopener noreferrer nofollow">{hostOf(href)}</a> }] : []),
  ];
}

/** The full note (SPEC §7.4) with its quote, source link and the disclaimer (SPEC §14 Q5). */
export const NoteView: FC<{ e: PublicEvent }> = ({ e }) => {
  const n = e.note as Note | null;
  const href = safeHref(e.quoteUrl);
  const alternatives = (n?.options ?? []).map((o) => ({ ...o, entry: catalogEntry(o.catalog_id) }));
  return (
    <article class="note">
      {e.quote ? (
        <>
          <h2 class="visually-hidden">From the source</h2>
          <Quote text={e.quote} href={href} url={e.quoteUrl} />
        </>
      ) : (
        <p>
          Source:{" "}
          {href ? (
            <a href={href} rel="noopener noreferrer nofollow">
              {e.quoteUrl}
            </a>
          ) : (
            e.quoteUrl
          )}
        </p>
      )}
      {n && (
        <>
          <h2>What this means for you</h2>
          <p>{whoIsAffected(n, subjectName(e))}</p>
        </>
      )}
      {n?.who_is_not_affected && (
        <>
          <h2>Who is not affected</h2>
          <p>{n.who_is_not_affected}</p>
        </>
      )}
      {alternatives.length > 0 && (
        <>
          <h2>Ways out</h2>
          <ul class="options">
            {alternatives.map((o) => (
              <OptionCard name={o.entry ? <a href={`/catalog/${o.entry.id}`}>{o.entry.name}</a> : o.name} effort={o.effort} why={o.why} />
            ))}
          </ul>
        </>
      )}
      {n && n.uncertain.length > 0 && (
        <>
          <h2>What the source doesn't say</h2>
          <ul class="uncertain">
            {n.uncertain.map((u) => (
              <li>{u}</li>
            ))}
          </ul>
        </>
      )}
      <p class="disclaimer">
        <Icon name="info" /> Summary, not legal advice; read the source.
      </p>
    </article>
  );
};
