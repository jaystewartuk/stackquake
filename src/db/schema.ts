// D1 / SQLite schema for M1 (SPEC §6). Times are Unix milliseconds.
// Columns marked "M1 addition" are not in SPEC §6; see the M1 summary for why.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const SOURCE_KINDS = ["npm", "pypi", "github_repo", "eol", "feed", "page"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_STATES = ["active", "blocked", "disabled"] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

export const EVENT_KINDS = ["license", "eol", "acquisition", "pricing", "free_tier", "deprecated", "archived", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_STATUSES = ["pending_llm", "pending_review", "published", "rejected"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const JOB_KINDS = ["poll", "extract_diff"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

// Catalog entries as loaded from catalog/*.yaml (M1 addition: SPEC keeps them only as files).
export const catalog = sqliteTable("catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  data: text("data", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: SOURCE_KINDS }).notNull(),
    key: text("key").notNull(),
    url: text("url").notNull(),
    selector: text("selector"),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    state: text("state", { enum: SOURCE_STATES }).notNull().default("active"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    nextPollAt: integer("next_poll_at").notNull(),
    failCount: integer("fail_count").notNull().default(0),
    lastOkAt: integer("last_ok_at"),
    // M1 additions: comparator state and block tracking.
    lastSha: text("last_sha"),
    lastState: text("last_state", { mode: "json" }),
    blockStrikes: integer("block_strikes").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("sources_kind_key").on(t.kind, t.key), index("sources_next_poll_at").on(t.nextPollAt)],
);

// Which catalog entries use which source (M1 addition). A feed can serve several entries,
// each with its own keyword filter.
export const catalogSources = sqliteTable(
  "catalog_sources",
  {
    catalogId: text("catalog_id").notNull(),
    sourceId: integer("source_id").notNull(),
    filter: text("filter", { mode: "json" }).$type<string[]>(),
  },
  (t) => [primaryKey({ columns: [t.catalogId, t.sourceId] }), index("catalog_sources_source").on(t.sourceId)],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    httpStatus: integer("http_status").notNull(),
    sha256: text("sha256"),
    size: integer("size"),
    r2Key: text("r2_key"),
  },
  (t) => [index("snapshots_source_fetched").on(t.sourceId, t.fetchedAt)],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull(),
    catalogId: text("catalog_id"), // M1 addition: scope of the dedupe key
    kind: text("kind", { enum: EVENT_KINDS }).notNull(),
    detectedAt: integer("detected_at").notNull(),
    publishedAt: integer("published_at"),
    effectiveDate: text("effective_date"),
    status: text("status", { enum: EVENT_STATUSES }).notNull(),
    confidence: real("confidence"),
    title: text("title").notNull(),
    quote: text("quote"),
    quoteUrl: text("quote_url").notNull(),
    beforeText: text("before_text"),
    afterText: text("after_text"),
    note: text("note", { mode: "json" }),
    appliesWhen: text("applies_when", { mode: "json" }),
    dedupeKey: text("dedupe_key").notNull().unique(),
  },
  (t) => [index("events_status_detected").on(t.status, t.detectedAt)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: JOB_KINDS }).notNull(),
    sourceId: integer("source_id"),
    eventId: integer("event_id"),
    runAfter: integer("run_after").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: integer("locked_until"),
    lastError: text("last_error"),
    // M1 additions: step input, a key that stops the same job being queued twice, and parking.
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    dedupeKey: text("dedupe_key").unique(),
    parkedAt: integer("parked_at"),
  },
  (t) => [index("jobs_run_after").on(t.runAfter)],
);

// robots.txt cache, one row per host (M1 addition).
export const robots = sqliteTable("robots", {
  host: text("host").primaryKey(),
  body: text("body").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export type Source = typeof sources.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
