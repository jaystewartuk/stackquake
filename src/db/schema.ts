// D1 / SQLite schema (SPEC §6). Times are Unix milliseconds.
// Columns marked "M1 addition" or "M2 addition" are not in SPEC §6; docs/DECISIONS.md says why.
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

export const JOB_KINDS = ["poll", "extract_diff", "fetch_post", "classify", "summarise", "import", "fanout", "deliver", "digest"] as const;
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
    // M2 additions.
    /** Blob keys of the full source text (post, page snapshots) the quote must be found in. */
    sourceKeys: text("source_keys", { mode: "json" }).$type<string[]>(),
    /** The classifier's output (feed items); its presence means classify has run. */
    classification: text("classification", { mode: "json" }),
    /** Why the event is in pending_review or rejected, for the admin view. */
    reviewReason: text("review_reason"),
    quoteFound: integer("quote_found", { mode: "boolean" }),
    /** Semantic dedupe: the older event this one repeats (status is then `rejected`). */
    duplicateOf: integer("duplicate_of"),
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

// One row per LLM request (SPEC §6), for cost tracking. Extra columns are M2 additions.
export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull(),
    eventId: integer("event_id"),
    /** ok | refusal | incomplete */
    outcome: text("outcome").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("llm_calls_created").on(t.createdAt)],
);

// robots.txt cache, one row per host (M1 addition).
export const robots = sqliteTable("robots", {
  host: text("host").primaryKey(),
  body: text("body").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

// ---- M3: users, auth and stacks (SPEC §6) ----

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  githubId: integer("github_id").unique(),
  name: text("name"),
  plan: text("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  /** 0 = Sunday … 6 = Saturday. */
  digestDay: integer("digest_day").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  // M4 additions.
  /** Off: urgent alerts wait for the weekly digest too ("digest only"). */
  emailImmediate: integer("email_immediate", { mode: "boolean" }).notNull().default(true),
  /** When the last weekly digest was sent (the "first digest of the month" rule). */
  lastDigestAt: integer("last_digest_at"),
});

/** `id` is the sha256 of the cookie value, so a database leak does not leak live sessions. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(), // M3 addition
  },
  (t) => [index("sessions_user").on(t.userId)],
);

export const magicLinks = sqliteTable("magic_links", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  // M3 additions: set when the link confirms an email change for a signed-in user.
  userId: integer("user_id"),
  createdAt: integer("created_at").notNull(),
});

/** Fixed-window counters (M3 addition): magic-link requests per email and per IP. */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

export const HOSTING_VALUES = ["hosted", "self_hosted"] as const;
export const USE_VALUES = ["commercial", "personal"] as const;
export const TIER_VALUES = ["free", "paid"] as const;

/** A usage profile (SPEC §7.1). A missing key means unknown, which counts as "assume affected". */
export interface Profile {
  hosting?: (typeof HOSTING_VALUES)[number];
  use?: (typeof USE_VALUES)[number];
  tier?: (typeof TIER_VALUES)[number];
}

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    name: text("name").notNull(),
    repoFullName: text("repo_full_name"),
    githubInstallationId: integer("github_installation_id"),
    defaultProfile: text("default_profile", { mode: "json" }).$type<Profile>().notNull().default(sql`'{}'`),
    lastImportAt: integer("last_import_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("projects_user").on(t.userId)],
);

export const DEP_ORIGINS = ["import", "manual"] as const;

export const deps = sqliteTable(
  "deps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").notNull(),
    catalogId: text("catalog_id"),
    /** npm | pypi | go | crates | gem | composer for packages; "eol" for runtimes outside the catalog. */
    ecosystem: text("ecosystem"),
    package: text("package"),
    versionSpec: text("version_spec"),
    eolProduct: text("eol_product"),
    eolCycle: text("eol_cycle"),
    profile: text("profile", { mode: "json" }).$type<Profile>().notNull().default(sql`'{}'`),
    mutedUntil: integer("muted_until"),
    origin: text("origin", { enum: DEP_ORIGINS }).notNull(),
    // M3 additions.
    /**
     * `catalog:<id>`, `<ecosystem>:<package>` or `eol:<product>`. SPEC's UNIQUE(project_id,
     * catalog_id, ecosystem, package) does not work in SQLite, where NULLs are all distinct.
     */
    depKey: text("dep_key").notNull(),
    /** Packages only: importance rank within the project (1 = most important); top 25 are shown. */
    rank: integer("rank"),
    /** Where import found it (manifest paths), for the dep page. */
    foundIn: text("found_in", { mode: "json" }).$type<string[]>(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("deps_project_key").on(t.projectId, t.depKey)],
);

export const depSources = sqliteTable(
  "dep_sources",
  {
    depId: integer("dep_id").notNull(),
    sourceId: integer("source_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.depId, t.sourceId] }), index("dep_sources_source").on(t.sourceId)],
);

export const IMPORT_STATUSES = ["running", "done", "failed"] as const;

/** A public repo import (M3 addition): a small state machine run one step per request or tick. */
export const imports = sqliteTable(
  "imports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").notNull(),
    repo: text("repo").notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull(),
    step: text("step").notNull(),
    state: text("state", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("imports_project").on(t.projectId)],
);

/** Free text from the picker that matched no catalog entry (SPEC §7.1, admin view). */
export const catalogRequests = sqliteTable("catalog_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

// ---- M4: alerts and channels (SPEC §6, §7.5) ----

export const ALERT_CHANNELS = ["email", "slack", "digest"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export const ALERT_STATUSES = ["queued", "sent", "failed", "suppressed"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const ALERT_MATCHES = ["affected", "unknown", "not_affected"] as const;
/** Why an alert waits for the digest. */
export const HELD_REASONS = ["not_urgent", "rate_limit", "digest_only"] as const;
export type HeldReason = (typeof HELD_REASONS)[number];
export const FEEDBACK = ["useful", "not_relevant"] as const;
export type Feedback = (typeof FEEDBACK)[number];

/**
 * One per user and event. `channel` is the route chosen at fan-out: "email" or "slack" for an
 * immediate alert, "digest" for one held for the weekly digest (suppressed ones too).
 */
export const alerts = sqliteTable(
  "alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    eventId: integer("event_id").notNull(),
    depId: integer("dep_id").notNull(),
    channel: text("channel", { enum: ALERT_CHANNELS }).notNull(),
    status: text("status", { enum: ALERT_STATUSES }).notNull(),
    sentAt: integer("sent_at"),
    feedback: text("feedback", { enum: FEEDBACK }),
    // M4 additions beyond SPEC §6.
    createdAt: integer("created_at").notNull(),
    match: text("match", { enum: ALERT_MATCHES }).notNull(),
    /** "Affects you because: …", written at fan-out. */
    because: text("because").notNull(),
    held: text("held", { enum: HELD_REASONS }),
    /** Took one of the user's 3 immediate slots per 24 h (the rate limit counts these). */
    claimedAt: integer("claimed_at"),
    emailedAt: integer("emailed_at"),
    slackAt: integer("slack_at"),
    /** A Slack post started. Set without slack_at means the invocation died mid-post: never retried. */
    slackTryAt: integer("slack_try_at"),
    /** Start of the UTC day of the digest that carried (or is carrying) this alert. */
    digestAt: integer("digest_at"),
    feedbackAt: integer("feedback_at"),
    error: text("error"),
  },
  (t) => [uniqueIndex("alerts_user_event").on(t.userId, t.eventId), index("alerts_user_status").on(t.userId, t.status), index("alerts_event").on(t.eventId)],
);

export const channels = sqliteTable(
  "channels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    kind: text("kind", { enum: ["slack"] }).notNull(),
    /** AES-GCM with CHANNEL_KEY (src/alerts/secretbox.ts). */
    webhookUrlEnc: text("webhook_url_enc").notNull(),
    verifiedAt: integer("verified_at"),
    // M4 additions.
    /** Last characters of the URL, to tell webhooks apart without showing the secret. */
    hint: text("hint").notNull(),
    createdAt: integer("created_at").notNull(),
    lastError: text("last_error"),
  },
  (t) => [index("channels_user").on(t.userId)],
);

export type Source = typeof sources.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type LlmCall = typeof llmCalls.$inferSelect;
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Dep = typeof deps.$inferSelect;
export type NewDep = typeof deps.$inferInsert;
export type Import = typeof imports.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Channel = typeof channels.$inferSelect;

/**
 * GitHub App installations (M5, SPEC §4.1, §7.1): the cached installation token, encrypted at rest
 * with CHANNEL_KEY (src/alerts/secretbox.ts). Projects point here by `github_installation_id`.
 */
export const githubInstallations = sqliteTable("github_installations", {
  id: integer("id").primaryKey(),
  account: text("account").notNull(),
  tokenEnc: text("token_enc"),
  tokenExpiresAt: integer("token_expires_at"),
  suspendedAt: integer("suspended_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export type GithubInstallation = typeof githubInstallations.$inferSelect;
