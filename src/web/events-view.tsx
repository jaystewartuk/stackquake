// Published events as shown to users: lists, the full note, and the subject's display name.
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { FC } from "hono/jsx";
import type { Ctx } from "../context";
import { catalogSources, events, sources, type Event } from "../db/schema";
import type { Note } from "../llm/schemas";
import { catalogEntry } from "./catalog-view";
import type { IconName } from "./icons";
import { fmtDate, safeHref } from "./layout";
import { Badge, DataList, Quote } from "./ui";

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

export const EventRow: FC<{ e: PublicEvent }> = ({ e }) => {
  const n = e.note as Note | null;
  return (
    <li>
      <div class="spread">
        <a href={`/events/${e.id}`}>
          <strong>{subjectName(e)}</strong>: {e.title}
        </a>
        <span class="meta">{fmtDate(e.publishedAt)}</span>
      </div>
      <div class="row meta">
        <KindPill kind={e.kind} />
        {e.effectiveDate && <span>effective {e.effectiveDate}</span>}
      </div>
      {n?.what_changed && <p class="muted" style="margin:.3rem 0 0">{n.what_changed}</p>}
    </li>
  );
};

/** The full note (SPEC §7.4) with its quote, source link and the disclaimer (SPEC §14 Q5). */
export const NoteView: FC<{ e: PublicEvent }> = ({ e }) => {
  const n = e.note as Note | null;
  const href = safeHref(e.quoteUrl);
  const alternatives = (n?.options ?? []).map((o) => ({ ...o, entry: catalogEntry(o.catalog_id) }));
  return (
    <article>
      <DataList
        strip
        label="Facts"
        items={[
          { term: "Published", value: <time datetime={fmtDate(e.publishedAt)}>{fmtDate(e.publishedAt)}</time> },
          ...(e.effectiveDate ? [{ term: "Takes effect", value: e.effectiveDate, highlight: true }] : []),
        ]}
      />
      {n?.what_changed && <p class="lede">{n.what_changed}</p>}
      {e.quote ? (
        <>
          <h2>From the source</h2>
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
      {n?.who_is_not_affected && (
        <>
          <h2>Who is not affected</h2>
          <p>{n.who_is_not_affected}</p>
        </>
      )}
      {alternatives.length > 0 && (
        <>
          <h2>Ways out</h2>
          <ul>
            {alternatives.map((o) => (
              <li>
                <strong>{o.entry ? <a href={`/catalog/${o.entry.id}`}>{o.entry.name}</a> : o.name}</strong> ({o.effort} effort): {o.why}
              </li>
            ))}
          </ul>
        </>
      )}
      {n && n.uncertain.length > 0 && (
        <>
          <h2>What the source doesn't say</h2>
          <ul>
            {n.uncertain.map((u) => (
              <li>{u}</li>
            ))}
          </ul>
        </>
      )}
      <p class="meta">Summary, not legal advice; read the source.</p>
    </article>
  );
};
