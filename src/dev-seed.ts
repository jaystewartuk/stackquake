// Deterministic demo data for screenshots and UI audits (POST /__dev/seed, local only behind
// DEV_ROUTES; driven by `npm run ui:seed`). It wipes every user, project, event and alert in the
// local D1 and writes the same set each time: two projects (one from a monorepo import, one from
// the picker), published events of each kind with quotes and notes, alerts in every state, a
// muted dep, and a Team owner with two members. Quotes and notes are fixture text written for the
// screenshots, not verbatim vendor copy.
import { sql } from "drizzle-orm";
import { syncCatalog } from "./catalog/catalog";
import { CATALOG } from "./catalog/entries";
import type { Ctx } from "./context";
import type { Note } from "./llm/schemas";
import { addCatalogDeps, linkSources, upsertDeps, type DepWrite } from "./stack/deps";
import { DAY } from "./util";

/** Every seeded time is relative to this instant, so two runs render the same dates. */
export const SEED_BASE = Date.UTC(2026, 9, 11, 9, 0, 0);
const at = (days: number) => SEED_BASE + days * DAY;

export const SEED_USERS = { owner: "dev@example.com", member: "sam@example.com", member2: "alex@example.com", free: "free@example.com", fresh: "new@example.com" };

const WIPE = ["alerts", "dep_sources", "deps", "imports", "projects", "team_members", "channels", "catalog_requests", "sessions", "magic_links", "rate_limits", "users", "events", "jobs", "llm_calls", "stripe_events"];

type EventSeed = {
  key: string;
  catalogId: string | null;
  /** Which of the dep's sources the event came from. */
  source: { catalogId: string; kind: string } | { kind: "npm"; key: string };
  kind: Note["kind"];
  title: string;
  published: number;
  effective: string | null;
  quote: string;
  quoteUrl: string;
  whatChanged: string;
  notAffected?: string;
  applies?: Partial<Note["applies_when"]>;
  options?: Note["options"];
  uncertain?: string[];
  status?: "published" | "pending_review" | "rejected";
  before?: string;
  after?: string;
};

const EVENTS: EventSeed[] = [
  {
    key: "deno-eol",
    catalogId: "deno",
    source: { catalogId: "deno", kind: "feed" },
    kind: "eol",
    title: "Deno runtime development ends in about a year",
    published: -2,
    effective: "2027-10",
    quote: "We will support the Deno runtime for another year with monthly releases containing bug fixes and security updates. After that year we will end our development of the Deno runtime.",
    quoteUrl: "https://deno.com/blog/cloudflare",
    whatChanged: "The Deno team is joining Cloudflare. The runtime gets monthly bug-fix and security releases for one more year, then development stops. Deno Deploy is not covered by this note.",
    options: [
      { catalog_id: "nodejs", name: "Node.js 24 LTS", why: "Mature runtime with long support windows; most Deno code runs with small changes.", effort: "medium" },
      { catalog_id: "bun", name: "Bun", why: "TypeScript-first and fast to start, like Deno.", effort: "medium" },
      { catalog_id: "cloudflare-workers", name: "Cloudflare Workers", why: "Where the Deno team is going; a good fit for edge APIs.", effort: "high" },
    ],
    uncertain: ["What happens to Deno Deploy and its customers", "Whether the community will fork the runtime"],
  },
  {
    key: "workers-ai-free",
    catalogId: "cloudflare-workers-ai",
    source: { catalogId: "cloudflare-workers-ai", kind: "page" },
    kind: "free_tier",
    title: "Free allowance drops from 10,000 to 5,000 neurons a day",
    published: -6,
    effective: "2026-11-01",
    quote: "Workers AI includes 5,000 Neurons per day at no charge on both the Workers Free and Workers Paid plans.",
    quoteUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    whatChanged: "The daily free allowance of Workers AI is halved, from 10,000 to 5,000 neurons. Usage above it is billed at $0.011 per 1,000 neurons on Workers Paid; on Workers Free, requests fail once the allowance is used.",
    applies: { tier: ["free"] },
    notAffected: "Accounts whose daily usage stays under 5,000 neurons.",
    options: [{ catalog_id: "openai-api", name: "OpenAI API", why: "Pay per token with no daily cap.", effort: "medium" }],
    before: "Workers AI includes 10,000 Neurons per day at no charge",
    after: "Workers AI includes 5,000 Neurons per day at no charge",
  },
  {
    key: "redis-license",
    catalogId: "redis",
    source: { catalogId: "redis", kind: "feed" },
    kind: "license",
    title: "Redis moves from BSD to a dual RSALv2 and SSPLv1 licence",
    published: -12,
    effective: "2026-11-15",
    quote: "Beginning with Redis 7.4, Redis will be dual-licensed under the Redis Source Available License (RSALv2) and Server Side Public License (SSPLv1).",
    quoteUrl: "https://redis.io/blog/redis-adopts-dual-source-available-licensing/",
    whatChanged: "New Redis releases are no longer open source under BSD-3. Self-hosting for your own app is still allowed; offering Redis as a managed service to others is not, without a commercial licence.",
    applies: { hosting: ["self_hosted"] },
    notAffected: "Teams that use Redis through a hosted provider (Upstash, Redis Cloud), or that stay on 7.2.",
    options: [
      { catalog_id: "valkey", name: "Valkey", why: "BSD-licensed fork of Redis 7.2 under the Linux Foundation; a drop-in replacement.", effort: "low" },
      { catalog_id: "upstash", name: "Upstash", why: "Hosted, Redis-compatible, serverless pricing.", effort: "low" },
    ],
    uncertain: ["Whether cloud providers' Redis offerings will switch to Valkey"],
  },
  {
    key: "vercel-pricing",
    catalogId: "vercel",
    source: { catalogId: "vercel", kind: "page" },
    kind: "pricing",
    title: "Pro plan bandwidth now billed per GB above 1 TB",
    published: -20,
    effective: "2026-12-01",
    quote: "Pro includes 1 TB of Fast Data Transfer per month. Additional usage is billed at $0.15 per GB.",
    quoteUrl: "https://vercel.com/pricing",
    whatChanged: "Vercel Pro keeps 1 TB of included transfer but bills overage per GB instead of in 100 GB blocks. Sites that stay under 1 TB pay the same.",
    applies: { tier: ["paid"] },
    options: [
      { catalog_id: "cloudflare-pages", name: "Cloudflare Pages", why: "No bandwidth charge for static assets.", effort: "medium" },
      { catalog_id: "netlify", name: "Netlify", why: "Similar workflow, different bandwidth pricing.", effort: "medium" },
    ],
    before: "Additional usage is billed at $40 per 100 GB.",
    after: "Additional usage is billed at $0.15 per GB.",
  },
  {
    key: "terraform-acq",
    catalogId: "terraform",
    source: { catalogId: "terraform", kind: "feed" },
    kind: "acquisition",
    title: "IBM completes its acquisition of HashiCorp",
    published: -34,
    effective: null,
    quote: "HashiCorp is now part of IBM. We will continue to build and support Terraform, Vault and our other products.",
    quoteUrl: "https://www.hashicorp.com/blog/hashicorp-is-now-part-of-ibm",
    whatChanged: "HashiCorp, the maker of Terraform and Vault, is now owned by IBM. Nothing changes in licensing or pricing today; the note is about who sets them from now on.",
    options: [{ catalog_id: "opentofu", name: "OpenTofu", why: "Open-source (MPL) fork of Terraform under the Linux Foundation.", effort: "low" }],
    uncertain: ["Whether Terraform Cloud pricing will change", "Plans for the BUSL licence"],
  },
  {
    key: "planetscale-free",
    catalogId: "planetscale",
    source: { catalogId: "planetscale", kind: "page" },
    kind: "free_tier",
    title: "Hobby plan retired; databases must move to a paid plan",
    published: -48,
    effective: "2026-12-08",
    quote: "We are retiring the Hobby plan. Hobby databases that are not upgraded by December 8 will be put to sleep.",
    quoteUrl: "https://planetscale.com/blog/planetscale-forever",
    whatChanged: "PlanetScale's free Hobby tier ends. Free databases sleep on the date unless they move to Scaler Pro (from $39 a month).",
    applies: { tier: ["free"] },
    options: [
      { catalog_id: "neon", name: "Neon", why: "Serverless Postgres with a free tier.", effort: "high" },
      { catalog_id: "turso", name: "Turso", why: "SQLite at the edge with a generous free tier.", effort: "high" },
    ],
  },
  {
    key: "node20-eol",
    catalogId: "nodejs",
    source: { catalogId: "nodejs", kind: "eol" },
    kind: "eol",
    title: "Node.js 20 reaches end of life on 2026-04-30",
    published: -70,
    effective: "2026-04-30",
    quote: "Node.js 20: end of security support 2026-04-30.",
    quoteUrl: "https://endoflife.date/nodejs",
    whatChanged: "Node.js 20 stops getting security fixes. Move to Node.js 22 or 24 LTS.",
    options: [{ catalog_id: "nodejs", name: "Node.js 24 LTS", why: "Supported until 2028-04.", effort: "low" }],
  },
  {
    key: "request-deprecated",
    catalogId: null,
    source: { kind: "npm", key: "request" },
    kind: "deprecated",
    title: "request (npm) is deprecated",
    published: -80,
    effective: null,
    quote: "request has been deprecated, see https://github.com/request/request/issues/3142",
    quoteUrl: "https://www.npmjs.com/package/request",
    whatChanged: "The request HTTP client is deprecated and gets no fixes. It still installs and works.",
    options: [{ catalog_id: null, name: "undici or fetch", why: "Built into Node.js 18+.", effort: "low" }],
  },
  {
    key: "docker-pricing",
    catalogId: "docker-desktop",
    source: { catalogId: "docker-desktop", kind: "page" },
    kind: "pricing",
    title: "Docker Business price rises to $24 per user",
    published: -120,
    effective: "2026-07-01",
    quote: "Docker Business: $24 per user per month, billed annually.",
    quoteUrl: "https://www.docker.com/pricing/",
    whatChanged: "Docker Business goes from $21 to $24 per user per month. Personal use and small businesses (under 250 employees and $10M revenue) stay free.",
    applies: { use: ["commercial"] },
    notAffected: "Personal use, education and small businesses.",
    options: [{ catalog_id: null, name: "Podman Desktop", why: "Free, open-source, Docker-compatible.", effort: "medium" }],
  },
  {
    key: "bitwarden-license",
    catalogId: "bitwarden",
    source: { catalogId: "bitwarden", kind: "github_repo" },
    kind: "license",
    title: "Bitwarden SDK dependency adds a non-free licence to the clients",
    published: -150,
    effective: null,
    quote: "You may not use this SDK to develop applications for use with software other than Bitwarden (including non-compatible implementations of Bitwarden) or to develop another SDK.",
    quoteUrl: "https://github.com/bitwarden/sdk/blob/main/LICENSE",
    whatChanged: "The Bitwarden clients now depend on an SDK under a licence that is not open source. Building the clients from source for use with a non-Bitwarden server is restricted.",
    applies: { hosting: ["self_hosted"] },
    notAffected: "Self-hosters who use the official clients from the app stores unchanged.",
    options: [{ catalog_id: "vaultwarden", name: "Vaultwarden", why: "Keeps working with the official clients; not affected by the SDK licence.", effort: "low" }],
    uncertain: ["Whether Bitwarden will relicense the SDK under GPL as it suggested"],
  },
  {
    key: "sentry-pricing-review",
    catalogId: "sentry",
    source: { catalogId: "sentry", kind: "page" },
    kind: "pricing",
    title: "Team plan event quota changes",
    published: 0,
    effective: null,
    quote: "Team: 50K errors included per month.",
    quoteUrl: "https://sentry.io/pricing/",
    whatChanged: "The page now lists 50K errors on Team; the previous snapshot listed 50K errors and 5GB of attachments.",
    status: "pending_review",
    before: "Team: 50K errors, 5GB attachments included per month.",
    after: "Team: 50K errors included per month.",
  },
  {
    key: "stripe-rejected",
    catalogId: "stripe",
    source: { catalogId: "stripe", kind: "feed" },
    kind: "other",
    title: "Stripe Sessions recap",
    published: 0,
    effective: null,
    quote: "Here is everything we launched at Sessions this year.",
    quoteUrl: "https://stripe.com/blog/sessions",
    whatChanged: "A product launch round-up with no change to pricing, terms or support.",
    status: "rejected",
  },
];

function note(e: EventSeed): Note {
  return {
    material: e.status !== "rejected",
    kind: e.kind,
    title: e.title,
    what_changed: e.whatChanged,
    quote: e.quote,
    effective_date: e.effective,
    applies_when: { hosting: [], use: [], tier: [], ...e.applies },
    who_is_not_affected: e.notAffected ?? null,
    options: e.options ?? [],
    uncertain: e.uncertain ?? [],
    confidence: 0.95,
  };
}

const imported = (paths: string[], rank: number | null = null) => ({ foundIn: paths, rank });

/** The monorepo import: services, runtimes and npm/PyPI packages found in its manifests. */
const IMPORTED: DepWrite[] = [
  ...["cloudflare-workers", "cloudflare-d1", "cloudflare-workers-ai", "stripe", "resend", "sentry", "planetscale"].map((id) => ({ depKey: `catalog:${id}`, catalogId: id, ecosystem: null, package: null, versionSpec: null, eolProduct: null, eolCycle: null, ...imported(["apps/api/wrangler.toml", "apps/api/package.json"]) })),
  { depKey: "catalog:nodejs", catalogId: "nodejs", ecosystem: null, package: null, versionSpec: null, eolProduct: "nodejs", eolCycle: "20", ...imported([".nvmrc", "apps/web/package.json"]) },
  { depKey: "eol:postgresql", catalogId: null, ecosystem: "eol", package: null, versionSpec: null, eolProduct: "postgresql", eolCycle: "14", ...imported(["docker-compose.yml"]) },
  { depKey: "npm:hono", catalogId: null, ecosystem: "npm", package: "hono", versionSpec: "^4.6.0", eolProduct: null, eolCycle: null, ...imported(["apps/api/package.json"], 1) },
  { depKey: "npm:drizzle-orm", catalogId: null, ecosystem: "npm", package: "drizzle-orm", versionSpec: "^0.36.0", eolProduct: null, eolCycle: null, ...imported(["apps/api/package.json"], 2) },
  { depKey: "npm:react", catalogId: null, ecosystem: "npm", package: "react", versionSpec: "^19.0.0", eolProduct: null, eolCycle: null, ...imported(["apps/web/package.json"], 3) },
  { depKey: "npm:request", catalogId: null, ecosystem: "npm", package: "request", versionSpec: "^2.88.2", eolProduct: null, eolCycle: null, ...imported(["packages/legacy-sync/package.json"], 4) },
  { depKey: "npm:left-justify", catalogId: null, ecosystem: "npm", package: "left-justify", versionSpec: "1.0.3", eolProduct: null, eolCycle: null, ...imported(["packages/legacy-sync/package.json"], 5) },
  { depKey: "pypi:fastapi", catalogId: null, ecosystem: "pypi", package: "fastapi", versionSpec: ">=0.110", eolProduct: null, eolCycle: null, ...imported(["services/ml/pyproject.toml"], 6) },
  { depKey: "go:github.com/spf13/cobra", catalogId: null, ecosystem: "go", package: "github.com/spf13/cobra", versionSpec: "v1.8.0", eolProduct: null, eolCycle: null, ...imported(["tools/cli/go.mod"], 7) },
];

/** The picker project: a self-hoster's and side project's services. */
const PICKED = ["deno", "redis", "terraform", "vercel", "docker-desktop", "bitwarden", "vaultwarden", "supabase"];

export async function seedDemo(ctx: Ctx): Promise<Record<string, unknown>> {
  for (const t of WIPE) await ctx.db.run(sql.raw(`DELETE FROM ${t}`));
  await ctx.db.run(sql.raw(`DELETE FROM sqlite_sequence WHERE name IN (${WIPE.map((t) => `'${t}'`).join(",")})`));
  await syncCatalog(ctx, CATALOG);
  // Sources: clean state, then the flags the dashboard reads.
  await ctx.db.run(sql`UPDATE sources SET state = 'active', last_state = NULL, last_error = NULL, fail_count = 0, block_strikes = 0, last_ok_at = ${at(-1)}`);

  const user = async (email: string, extra: Record<string, unknown> = {}) => {
    const cols = { email, created_at: at(-60), ...extra };
    const keys = Object.keys(cols);
    const [row] = await ctx.db.all<{ id: number }>(sql`INSERT INTO users (${sql.raw(keys.join(", "))}) VALUES (${sql.join(Object.values(cols).map((v) => sql`${v}`), sql`, `)}) RETURNING id`);
    return row.id;
  };
  const owner = await user(SEED_USERS.owner, { name: "Dev", plan: "team", plan_status: "active", plan_interval: "month", plan_period_end: at(20), digest_day: 1 });
  const member = await user(SEED_USERS.member, { name: "Sam" });
  const member2 = await user(SEED_USERS.member2, { name: "Alex" });
  const free = await user(SEED_USERS.free);
  await ctx.db.run(sql`INSERT INTO team_members (owner_id, email, user_id, invited_at, joined_at) VALUES
    (${owner}, ${SEED_USERS.member}, ${member}, ${at(-30)}, ${at(-29)}),
    (${owner}, ${SEED_USERS.member2}, ${member2}, ${at(-10)}, ${at(-9)}),
    (${owner}, 'riley@example.com', NULL, ${at(-1)}, NULL)`);

  // Project 1: monorepo import.
  const [p1] = await ctx.db.all<{ id: number }>(sql`INSERT INTO projects (user_id, name, repo_full_name, default_profile, last_import_at, created_at)
    VALUES (${owner}, 'platform', 'acme-labs/platform', ${JSON.stringify({ use: "commercial" })}, ${at(-3)}, ${at(-40)}) RETURNING id`);
  const imp = await upsertDeps(ctx, p1.id, IMPORTED, "import");
  await linkSources(ctx, imp);
  await ctx.db.run(sql`INSERT INTO imports (project_id, repo, status, step, state, created_at, updated_at) VALUES (${p1.id}, 'acme-labs/platform', 'done', 'done',
    ${JSON.stringify({ owner: "acme-labs", name: "platform", paths: [], dirs: [], found: {}, errors: 0, log: ["Listed 412 files", "Read 14 manifests", "Matched 8 services and 2 runtimes"], counts: { catalog: 8, runtimes: 2, packages: 6 } })}, ${at(-3)}, ${at(-3)})`);
  // Per-dep usage for the import (tier answers drive the free-tier events).
  await ctx.db.run(sql`UPDATE deps SET profile = '{"hosting":"hosted","tier":"free"}' WHERE project_id = ${p1.id} AND catalog_id IN ('cloudflare-workers-ai', 'planetscale')`);
  await ctx.db.run(sql`UPDATE deps SET profile = '{"hosting":"hosted","tier":"paid"}' WHERE project_id = ${p1.id} AND catalog_id IN ('cloudflare-workers', 'cloudflare-d1')`);

  // Project 2: picked services, self-hosted where it makes sense.
  const [p2] = await ctx.db.all<{ id: number }>(sql`INSERT INTO projects (user_id, name, default_profile, created_at) VALUES (${owner}, 'homelab', '{}', ${at(-20)}) RETURNING id`);
  await addCatalogDeps(ctx, p2.id, PICKED);
  await ctx.db.run(sql`UPDATE deps SET profile = '{"hosting":"self_hosted","use":"personal"}' WHERE project_id = ${p2.id} AND catalog_id IN ('redis', 'bitwarden', 'vaultwarden')`);
  await ctx.db.run(sql`UPDATE deps SET profile = '{"hosting":"hosted","use":"commercial","tier":"paid"}' WHERE project_id = ${p2.id} AND catalog_id = 'vercel'`);
  await ctx.db.run(sql`UPDATE deps SET muted_until = ${at(80)} WHERE project_id = ${p2.id} AND catalog_id = 'docker-desktop'`);

  // Registry state behind the risk groups: a deprecated and an unlicensed package; others licensed.
  await ctx.db.run(sql`UPDATE sources SET last_state = '{"license":"MIT","latest":"1.0.0"}' WHERE kind IN ('npm', 'pypi')`);
  await ctx.db.run(sql`UPDATE sources SET last_state = '{"license":"Apache-2.0","deprecated":"request has been deprecated, see https://github.com/request/request/issues/3142","latest":"2.88.2"}' WHERE kind = 'npm' AND key = 'request'`);
  await ctx.db.run(sql`UPDATE sources SET last_state = '{"latest":"1.0.3"}' WHERE kind = 'npm' AND key = 'left-justify'`);
  // One blocked and one failing source for /admin/sources.
  await ctx.db.run(sql`UPDATE sources SET state = 'blocked', block_strikes = 3, last_error = 'HTTP 403 three times (Cloudflare challenge page)' WHERE id = (SELECT min(s.id) FROM sources s JOIN catalog_sources cs ON cs.source_id = s.id WHERE cs.catalog_id = 'heroku' AND s.kind = 'page')`);
  await ctx.db.run(sql`UPDATE sources SET fail_count = 2, last_error = 'Selector "main .pricing" matched nothing' WHERE id = (SELECT min(s.id) FROM sources s JOIN catalog_sources cs ON cs.source_id = s.id WHERE cs.catalog_id = 'render' AND s.kind = 'page')`);

  // Events.
  const eventIds = new Map<string, number>();
  for (const e of EVENTS) {
    const src =
      "key" in e.source
        ? await ctx.db.get<{ id: number }>(sql`SELECT id FROM sources WHERE kind = ${e.source.kind} AND key = ${e.source.key}`)
        : await ctx.db.get<{ id: number }>(sql`SELECT min(s.id) AS id FROM sources s JOIN catalog_sources cs ON cs.source_id = s.id WHERE cs.catalog_id = ${e.source.catalogId} AND s.kind = ${e.source.kind}`);
    if (!src?.id) throw new Error(`no source for ${e.key}`);
    const status = e.status ?? "published";
    const n = note(e);
    const [row] = await ctx.db.all<{ id: number }>(sql`INSERT INTO events
      (source_id, catalog_id, kind, detected_at, published_at, effective_date, status, confidence, title, quote, quote_url, before_text, after_text, note, applies_when, dedupe_key, quote_found, review_reason)
      VALUES (${src.id}, ${e.catalogId}, ${e.kind}, ${at(e.published) - 3 * 3600_000}, ${status === "published" ? at(e.published) : null}, ${e.effective}, ${status}, ${status === "pending_review" ? 0.72 : 0.95},
        ${e.title}, ${e.quote}, ${e.quoteUrl}, ${e.before ?? null}, ${e.after ?? null}, ${JSON.stringify(n)}, ${JSON.stringify(n.applies_when)}, ${`seed:${e.key}`}, 1,
        ${status === "pending_review" ? "confidence 0.72 below 0.9" : status === "rejected" ? "classifier: not material" : null})
      RETURNING id`);
    eventIds.set(e.key, row.id);
  }

  // Alerts for the owner (and a couple for a member), in each state the inbox shows.
  const dep = async (projectId: number, depKey: string) => (await ctx.db.get<{ id: number }>(sql`SELECT id FROM deps WHERE project_id = ${projectId} AND dep_key = ${depKey}`))!.id;
  const alert = async (userId: number, key: string, depId: number, a: { channel: string; status: string; match: string; because: string; held?: string; sentAt?: number; emailed?: boolean; feedback?: string }) => {
    const ev = eventIds.get(key)!;
    const e = EVENTS.find((x) => x.key === key)!;
    await ctx.db.run(sql`INSERT INTO alerts (user_id, event_id, dep_id, channel, status, sent_at, feedback, created_at, match, because, held, emailed_at, digest_at, feedback_at)
      VALUES (${userId}, ${ev}, ${depId}, ${a.channel}, ${a.status}, ${a.sentAt ?? null}, ${a.feedback ?? null}, ${at(e.published) + 600_000}, ${a.match}, ${a.because}, ${a.held ?? null},
        ${a.emailed ? (a.sentAt ?? null) : null}, ${a.channel === "digest" && a.status === "sent" ? a.sentAt ?? null : null}, ${a.feedback ? at(e.published + 1) : null})`);
  };
  await alert(owner, "deno-eol", await dep(p2.id, "catalog:deno"), { channel: "email", status: "sent", match: "affected", because: "you use Deno in homelab, and the change applies to everyone who uses it.", sentAt: at(-2) + 900_000, emailed: true });
  await alert(owner, "workers-ai-free", await dep(p1.id, "catalog:cloudflare-workers-ai"), { channel: "email", status: "sent", match: "affected", because: "you use Cloudflare Workers AI on the free tier in platform.", sentAt: at(-6) + 900_000, emailed: true, feedback: "useful" });
  await alert(owner, "redis-license", await dep(p2.id, "catalog:redis"), { channel: "email", status: "sent", match: "affected", because: "you self-host Redis in homelab.", sentAt: at(-12) + 900_000, emailed: true });
  await alert(owner, "vercel-pricing", await dep(p2.id, "catalog:vercel"), { channel: "digest", status: "queued", match: "affected", because: "you use Vercel on a paid plan in homelab.", held: "not_urgent" });
  await alert(owner, "terraform-acq", await dep(p2.id, "catalog:terraform"), { channel: "digest", status: "sent", match: "unknown", because: "you use Terraform in homelab; the note doesn't say whether your usage is affected.", sentAt: at(-28), feedback: "not_relevant" });
  await alert(owner, "planetscale-free", await dep(p1.id, "catalog:planetscale"), { channel: "email", status: "failed", match: "affected", because: "you use PlanetScale on the free tier in platform." });
  await alert(owner, "docker-pricing", await dep(p2.id, "catalog:docker-desktop"), { channel: "digest", status: "suppressed", match: "not_affected", because: "Docker Desktop: the change applies to commercial use, and you use it personally." });
  await alert(owner, "bitwarden-license", await dep(p2.id, "catalog:bitwarden"), { channel: "digest", status: "sent", match: "affected", because: "you self-host Bitwarden in homelab.", sentAt: at(-146) });
  await alert(member, "deno-eol", await dep(p2.id, "catalog:deno"), { channel: "email", status: "sent", match: "affected", because: "you use Deno in homelab (acme team), and the change applies to everyone who uses it.", sentAt: at(-2) + 900_000, emailed: true });

  // The Free user: one project, so a second one is refused (the 402 pages).
  const [p3] = await ctx.db.all<{ id: number }>(sql`INSERT INTO projects (user_id, name, default_profile, created_at) VALUES (${free}, 'side-project', '{}', ${at(-5)}) RETURNING id`);
  await addCatalogDeps(ctx, p3.id, ["cloudflare-workers", "neon", "resend"]);

  // Import progress pages: one held part-way (its job is locked far ahead, so loading the page
  // doesn't run a step or call GitHub) and one that failed.
  const [running] = await ctx.db.all<{ id: number }>(sql`INSERT INTO imports (project_id, repo, status, step, state, created_at, updated_at) VALUES (${p3.id}, 'free-dev/side-project', 'running', 'fetch',
    ${JSON.stringify({ owner: "free-dev", name: "side-project", paths: [], dirs: [], found: {}, errors: 0, log: ["Reading free-dev/side-project", "Default branch main: 23 entries at the root", "Listed 4 folders"] })}, ${at(0)}, ${at(0)}) RETURNING id`);
  await ctx.db.run(sql`INSERT INTO jobs (kind, run_after, attempts, locked_until, payload, dedupe_key) VALUES ('import', ${at(365)}, 0, ${at(365)}, ${JSON.stringify({ importId: running.id })}, ${`import:${running.id}`})`);
  await ctx.db.run(sql`INSERT INTO imports (project_id, repo, status, step, state, error, created_at, updated_at) VALUES (${p2.id}, 'acme-labs/homelab', 'failed', 'repo',
    ${JSON.stringify({ owner: "acme-labs", name: "homelab", paths: [], dirs: [], found: {}, errors: 1, log: ["Reading acme-labs/homelab"] })}, 'Repository not found. Public repos can be pasted; private repos need the GitHub App (Team plan).', ${at(-50)}, ${at(-50)})`);

  // Admin views: catalog requests and a week of LLM spend.
  for (const [text, days] of [["Hetzner Cloud", -4], ["hetzner cloud", -2], ["CockroachDB", -3], ["Mailgun", -1]] as const) {
    await ctx.db.run(sql`INSERT INTO catalog_requests (user_id, text, created_at) VALUES (${owner}, ${text}, ${at(days)})`);
  }
  await ctx.db.run(sql`INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, cost_usd, event_id, outcome, created_at) VALUES
    ('classify', 'claude-haiku-5-5', 4100, 120, 0.0047, ${eventIds.get("sentry-pricing-review")!}, 'ok', ${at(-1)}),
    ('summarise', 'claude-opus-5-5', 6800, 900, 0.0565, ${eventIds.get("deno-eol")!}, 'ok', ${at(-2)})`);

  const ids = await ctx.db.all<{ id: number; dep_key: string; project_id: number }>(sql`SELECT id, dep_key, project_id FROM deps ORDER BY id`);
  return {
    ok: true,
    users: SEED_USERS,
    projects: { import: p1.id, picker: p2.id, free: p3.id },
    deps: ids.length,
    depIds: { muted: await dep(p2.id, "catalog:docker-desktop"), withEvents: await dep(p2.id, "catalog:deno"), package: await dep(p1.id, "npm:request") },
    events: Object.fromEntries(eventIds),
  };
}
