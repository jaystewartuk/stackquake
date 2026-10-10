# Product Spec: Stackquake, a change radar for the things your stack depends on

> Name: **Stackquake**. Domain: **stackquake.com** (registered 2026-10-10, DNS on Cloudflare). Status: v1 spec, 2026-10-10. Background on why this was picked is in `OPPORTUNITY.md`.
> This document is meant to be handed to an implementing engineer or model. It is self-contained. Where a decision has been made, it is stated as **MUST**/**SHOULD**. Open questions are collected in §14.

---

## 1. Summary

Teams build on runtimes, open-source libraries, self-hosted tools and paid cloud services. Any of these can change the deal underneath them: a licence change (Bitwarden, Redis, Terraform), an end of development (Deno, announced 2026-10-09 with one year of fixes left), an acquisition, a pricing change or a free-tier change (Cloudflare Workers AI "neurons"). The announcement is often vague, or the important line is buried at the bottom, and nobody on the team is watching every vendor's blog.

Stackquake has two parts:

1. **Watchers.** Scheduled jobs that poll a fixed set of sources for each dependency: package registries, GitHub repo metadata, licence files, end-of-life data, vendor blog feeds and vendor pricing and terms pages. They detect changes and turn the important ones into **events**.
2. **Web app.** You import a stack: paste a public repo, connect a GitHub repo, or pick services from a catalog. You say how you use each item (self-hosted or hosted, commercial or personal). You get an alert when an event affects you. Each alert is a short plain-English note: what changed (quoting the source line), whether it affects you, the deadline, and two or three ways out.

Events are computed **once per source** and shared by every user who depends on that source. Per-user work is rule-based, so costs grow with the number of distinct sources, not the number of users.

## 2. Goals and non-goals

### Goals (v1)
- G1: A licence change, end-of-life notice, acquisition or pricing/free-tier change for a watched source becomes an event within 24 hours of publication (6 hours for registry and GitHub metadata).
- G2: Every event note quotes its source text and links to it. No note is published without a quote.
- G3: Alerts are rare and right. Target: at most 1 alert per user per week on average, and fewer than 10% of alerts marked "not relevant" by users.
- G4: Importing a public repo takes under 60 seconds from paste to a populated dashboard.
- G5: The hosting bill is $0 per month up to about 1,000 distinct sources and 500 users (§4.2).

### Non-goals (v1)
- Security vulnerabilities and routine version bumps. Dependabot and Snyk already cover these, and covering them would break G3.
- Licence compliance reports for every transitive dependency (FOSSA's area). v1 watches direct dependencies and the services you list.
- Contract or legal advice. Notes say what changed and quote it; they never say "you are compliant".
- Monitoring arbitrary URLs that users add. v1 only watches sources in the curated catalog plus registry and GitHub data (see §14 Q3).

### Positioning (added 2026-10-10)
GitHub, Snyk or Socket could easily add alerts for package licence changes, deprecations and
archived repos; GitHub already has the dependency graph, Dependabot and licence checks in
dependency review. Treat that coverage as expected, not as the reason to pay. Stackquake wins on
what code-scanning tools don't see and platform vendors are badly placed to say:
- **Services, not just packages.** Pricing, free tiers, terms, end-of-development notices and
  acquisitions for hosted services and runtimes (Cloudflare, Vercel, Supabase, Deno). None of it
  is in a manifest.
- **Neutral.** An independent tool can be blunt about any vendor, GitHub and Microsoft included.
- **"What this means for you, and where to go."** A per-usage answer with alternatives, quoted
  from the source. Large platforms avoid interpreting other companies' licences.
- **Not tied to GitHub.** Works for GitLab users and self-hosters with no repo at all.

Consequences: lead the landing page and onboarding with services ("pick what you run on"), with
repo import as the quick way to fill the list, not the main path. Grow the catalog of
services faster than package coverage. Registry and GitHub watchers stay as cheap support.
Before launch, check what Dependabot, Snyk and Socket already flag for upstream licence changes,
and say plainly on the landing page where Stackquake differs.

## 3. Users and core scenarios

- **Solo developer / small team lead (primary).** Has 1–10 repos and a handful of paid services. Wants one email when something they use changes the deal, not a feed to read.
- **Engineering manager or CTO at a 10–100 person company (paying).** Wants a list of vendor risks across all repos, Slack alerts to a channel, and something to show in a procurement or audit review.
- **Self-hoster.** Runs Vaultwarden, Immich, Home Assistant and similar. Cares mainly about licence changes and whether clients stay buildable.

Scenarios:
1. **Deno end of development.** A user's repo has `deno.json`. The Deno blog post is published. Within 24 hours they receive: "Deno runtime: development ends around 2027-10 (Deno joined Cloudflare). Quote: 'We will support the Deno runtime for another year with monthly releases containing bug fixes and security updates. After that year we will end our development of the Deno runtime.' Affects you: yes (you run Deno in production). Options: Node.js 24 LTS, Bun, Cloudflare workerd/celld." Links: the post, the HN thread.
2. **Bitwarden licence change.** A self-hoster who listed "Bitwarden clients + Vaultwarden" gets a note saying which components the new licence covers. It says that personal self-hosting is not affected, if the source text supports that, or that this is unclear, if it does not. It lists alternative clients.
3. **Free-tier change.** A user who listed "Cloudflare Workers AI (free tier)" gets an alert when the pricing page's free allowance changes. The note shows the old and new values side by side.
4. **Weekly digest.** On Monday, a user with no urgent events gets one email: "No changes that affect you. 3 changes we watched that don't (expand)."

## 4. System architecture

```
                         ┌──────────── Cloudflare (one Worker, "stackquake") ─────────────┐
 browsers ── HTTPS ───▶  │  fetch():  web app (SSR) + JSON API + GitHub webhooks          │
                         │  scheduled(): cron dispatcher ──▶ watcher steps (batched)      │
                         │                                                                │
                         │  D1 (SQLite): users, stacks, deps, sources, snapshots meta,    │
                         │               events, notes, alerts, jobs                      │
                         │  R2: raw snapshot bodies (gzip), keyed by sha256               │
                         └───────┬───────────────┬───────────────┬────────────────────────┘
                                 │               │               │
              registries, GitHub API,     Claude API        Resend (email),
              endoflife.date, RSS feeds,  (classify +       Slack incoming webhooks,
              vendor pricing/terms pages  summarise)        Stripe (billing, M6)
```

- One Worker serves the web app, API and webhooks, and runs the cron handler. There are no long-lived connections and nothing needs to be always on.
- Watchers are **idempotent steps over a job table** in D1. Each cron firing claims a small batch of due jobs, does one step for each (fetch → hash → compare), records the result and exits. Bigger work (text extraction, diffing, LLM calls) happens only when a hash changes, as its own step.
- The LLM is called only for (a) classifying new feed posts and (b) writing the note for a detected change. Both are per source, never per user.

### 4.1 Recommended stack (swap only with good reason)
| Component | Choice | Rationale |
|---|---|---|
| Runtime / host | **Cloudflare Workers** (TypeScript) | $0 at the predicted volume; the domain is already on Cloudflare; cron is built in |
| HTTP framework | **Hono** with JSX server-side rendering | Small, runs on Workers and Node unchanged (portability, §4.3) |
| Client JS | Minimal: htmx or a few small islands | Dashboard is lists, forms and settings. Keeps per-request CPU low |
| DB | **D1** (SQLite) via **Drizzle ORM** | Free tier is far above the need; Drizzle's SQLite dialect also runs on libSQL/better-sqlite3 |
| Blob storage | **R2** | Raw snapshot bodies. 10 GB free |
| Scheduling | **Cron Triggers** (one every 5 minutes, one daily) | Uses 2 of the free plan's 5 cron triggers |
| LLM | **Claude API** via `@anthropic-ai/sdk`, model `claude-opus-5-5` (configurable by `LLM_MODEL`) | Structured outputs for the classifier and the note (§7.4). Cost in §4.2 |
| Email | **Resend** | Free tier: 3,000 emails/month, 100/day. Needs DNS records (SPF, DKIM) on stackquake.com |
| Auth | GitHub OAuth (sign-in) + email magic link; repo access through a **GitHub App** (contents: read, metadata: read) | Developer audience. The App gives read-only, per-repo access without the broad `repo` OAuth scope |
| Billing (M6) | Stripe Checkout + Customer Portal | Same pattern as Beckon |
| Tests | Vitest with `@cloudflare/vitest-pool-workers` (Miniflare) | Runs the real Workers runtime locally |

### 4.2 Hosting choice and predicted cost (next ~3 months)

Predicted use up to 2027-01: up to 500 sign-ups, about 100 weekly active users, about 300–1,000 distinct watched sources, under 20 events per week.

| Item | Free-plan limit | Predicted use | Cost |
|---|---|---|---|
| Worker requests | 100,000/day | Under 5,000/day (web + 288 cron firings) | $0 |
| Worker CPU | **10 ms per invocation** (HTTP and cron) | Fetching does not count; hashing uses `crypto.subtle` (native). Diff and parse steps are the risk | $0 (see below) |
| D1 | 5 M rows read/day, 100 k written/day, 5 GB | Under 200 k read, under 10 k written per day, under 100 MB | $0 |
| R2 | 10 GB, 1 M writes/month | Under 1 GB (only changed bodies are stored) | $0 |
| Cron Triggers | 5 per account | 2 | $0 |
| Resend | 3,000/month, 100/day | Under 1,000/month | $0 |
| Claude API (Opus 5.5, $4 / $20 per M tokens, low effort) | — | About 500 feed posts classified (~3 k in / 200 out each) plus about 60 notes (~8 k in / 800 out each) | **about $10/month** |
| **Total** | | | **about $10/month, all of it LLM** |

- **The 10 ms CPU limit is the one real constraint on the Free plan.** The design keeps every step small: one fetch and one hash per job, HTMLRewriter (native, streaming) for text extraction, diffing only extracted text with a size cap, and at most N jobs per cron firing (tunable `JOBS_PER_TICK`, default 10). If `exceededCpu` appears in Workers analytics on more than 1% of invocations on any day, **switch to Workers Paid ($5/month)**. It gives 30 s CPU per invocation, Queues and 10 M requests/month. It is a plan change, not a code change. Expect to need it at public launch (M6).
- **LLM cost lever (user's decision, §14 Q2).** Running classification on `claude-haiku-5-5` ($0.10 / $0.50 per M tokens) instead would cut the LLM line to well under $1/month. The spec defaults to Opus 5.5 at `low` effort because accuracy is G2/G3's whole point. Measure on the golden set (§11) before switching.
- **Rejected alternatives.** Fly.io (Beckon's choice) needs an always-on machine plus managed Postgres: about $5–40/month, and its strengths (WebSockets, always-on) are not needed here. Cloud Run + Neon would also be about $0 but needs Cloud Scheduler, a separate DB vendor and more setup. Vercel Hobby forbids commercial use.

### 4.3 Portability (dogfooding the product's own advice)

Stackquake is itself a project that depends on a vendor's free tier, which is exactly the risk it warns about. So:
- Cloudflare Workers, D1, R2 and Resend **MUST** be entries in Stackquake's own stack, watched by Stackquake.
- Platform-specific code **MUST** stay behind small interfaces: `Db` (Drizzle, SQLite dialect), `BlobStore` (R2 / filesystem), `Scheduler` (cron handler / `setInterval`), `Mailer`. A Node entry point (`src/node.ts`) running on libSQL or SQLite **SHOULD** keep working, checked by one CI job that runs the test suite on Node.

## 5. Sources and change detection

A **source** is one thing Stackquake polls. Sources are global and deduplicated. A user's dependency points at one or more sources.

| Source kind | Key | Poll every | What is compared | Becomes an event when |
|---|---|---|---|---|
| `npm` | package name | 6 h | `license` of latest version, `deprecated` message, `repository` | licence string changes; package or latest version becomes deprecated |
| `pypi` | package name | 6 h | `info.license`, `info.license_expression`, classifiers, yanked status | licence changes; project marked inactive or deprecated |
| `crates`, `go` | crate / module path | 12 h | licence, yanked or retracted | licence changes; latest version is yanked or retracted |
| `github_repo` | owner/repo | 6 h | `archived`, `license.spdx_id`, `LICENSE` file sha, transfer (owner changed) | archived; SPDX ID changes; licence file content changes; repo transferred |
| `eol` | endoflife.date product + cycle | 24 h | EOL and support dates for the cycle in use | EOL date set or moved earlier; date within 90 days (one reminder) |
| `feed` | vendor blog RSS/Atom URL | 1 h | new items | the classifier (§7.4) labels a new post as licence, EOL, acquisition, pricing or free-tier, with confidence ≥ 0.7 |
| `page` | vendor pricing/terms/licence URL + CSS selector | 24 h | extracted text of the selected region | normalised text changes and the summariser says the change is material |

Rules:
- **Snapshots.** Each poll stores `{source_id, fetched_at, status, sha256, size}` in D1. The body goes to R2 **only when the hash changes** (gzip, key `snap/<sha256>`). Keep the latest 20 bodies per source.
- **Normalisation** before hashing `page` text: strip scripts, styles, nav/footer outside the selector, dates matching common "updated N minutes ago" patterns, tracking parameters and whitespace runs. Each catalog entry may add its own ignore regexes. Without this, pages change on every poll.
- **Politeness.** Send `User-Agent: StackquakeBot/1.0 (+https://stackquake.com/bot)`, honour `robots.txt` for `page` and `feed` sources, use conditional requests (`If-None-Match` / `If-Modified-Since`), make at most 1 request per host per tick, and back off exponentially on 429/5xx (max 24 h).
- **Blocked sources.** If a host blocks automated fetches (403 or a challenge page 3 times in a row), mark the source `blocked`, stop polling it and show it in the admin view. (The Bitwarden forum blocked this project's research fetches, so expect this.)
- **Thresholds.** A `page` diff whose changed text is under 20 characters, or that only changes numbers inside an ignore regex, is dropped without an LLM call.

### 5.1 Curated catalog (v1)

`catalog/*.yaml`, checked into the repo, reviewed by a person. One file per vendor or project:

```yaml
id: cloudflare-workers
name: Cloudflare Workers
category: hosting
aliases: [workers, wrangler]         # used to match manifests and search
detect:                              # how repo import finds it
  files: [wrangler.toml, wrangler.json, wrangler.jsonc]
  npm: [wrangler, "@cloudflare/workers-types"]
sources:
  - kind: feed
    url: https://blog.cloudflare.com/rss/
    filter: [workers, pricing, free tier, durable objects, d1, r2]   # optional pre-filter before the classifier
  - kind: page
    url: https://developers.cloudflare.com/workers/platform/pricing/
    selector: main
  - kind: page
    url: https://developers.cloudflare.com/workers/platform/limits/
    selector: main
alternatives: [vercel-functions, fly-io, deno-deploy, aws-lambda]
usage_questions: [hosted]           # which usage-profile questions apply (§6)
```

v1 ships with **at least 40 entries**, chosen from what HN threads complained about and what developers commonly use: Cloudflare (Workers, D1, R2, Workers AI), Vercel, Netlify, Fly.io, Render, Railway, Supabase, Neon, PlanetScale, Firebase, Heroku, AWS Lambda, Deno + Deno Deploy, Bun, Node.js, Python, Postgres, Redis/Valkey, Elasticsearch/OpenSearch, Terraform/OpenTofu, Docker Desktop, GitHub Actions, Bitwarden + Vaultwarden, 1Password, Auth0, Clerk, Stripe, Resend, SendGrid, Twilio, OpenAI API, Anthropic API, Sentry, PostHog, Grafana, HashiCorp Vault, MongoDB, Kubernetes, Home Assistant, Immich.

## 6. Data model (D1 / SQLite)

```sql
users(id, email UNIQUE, github_id UNIQUE NULL, name, plan DEFAULT 'free',
      stripe_customer_id NULL, digest_day DEFAULT 1, created_at)
sessions(id, user_id, expires_at)            -- cookie sessions
magic_links(token_hash PK, email, expires_at, used_at NULL)

projects(id, user_id, name, repo_full_name NULL, github_installation_id NULL,
         default_profile JSON, last_import_at NULL, created_at)

-- one row per thing the user depends on
deps(id, project_id, catalog_id NULL, ecosystem NULL, package NULL, version_spec NULL,
     eol_product NULL, eol_cycle NULL,
     profile JSON,               -- {hosted|self_hosted, commercial|personal, tier: free|paid}
     muted_until NULL, origin 'import'|'manual', UNIQUE(project_id, catalog_id, ecosystem, package))

sources(id, kind, key UNIQUE(kind,key), url, selector NULL, config JSON,
        state 'active'|'blocked'|'disabled', etag NULL, last_modified NULL,
        next_poll_at, fail_count, last_ok_at NULL)
dep_sources(dep_id, source_id, PRIMARY KEY(dep_id, source_id))

snapshots(id, source_id, fetched_at, http_status, sha256, size, r2_key NULL)

-- candidate changes found by watchers, before and after review
events(id, source_id, kind 'license'|'eol'|'acquisition'|'pricing'|'free_tier'|'deprecated'|'archived'|'other',
       detected_at, published_at NULL, effective_date NULL,
       status 'pending_llm'|'pending_review'|'published'|'rejected',
       confidence REAL, title, quote, quote_url, before_text NULL, after_text NULL,
       note JSON NULL,             -- §7.4 output
       applies_when JSON NULL,     -- structured conditions, matched against deps.profile
       dedupe_key UNIQUE)          -- e.g. sha of (catalog_id, kind, normalised title) so one announcement seen
                                   -- via feed + page + registry becomes one event

alerts(id, user_id, event_id, dep_id, channel 'email'|'slack'|'digest',
       status 'queued'|'sent'|'failed'|'suppressed', sent_at NULL, feedback NULL 'useful'|'not_relevant',
       UNIQUE(user_id, event_id))
channels(id, user_id, kind 'slack', webhook_url_enc, verified_at NULL)

jobs(id, kind, source_id NULL, event_id NULL, run_after, attempts, locked_until NULL, last_error NULL)
llm_calls(id, purpose, model, input_tokens, output_tokens, cost_usd, created_at)   -- cost tracking
```

- Secrets (Slack webhook URLs, GitHub App installation tokens) are encrypted with a key from Worker secrets (AES-GCM via `crypto.subtle`).
- Indexes: `sources(next_poll_at)`, `jobs(run_after)`, `events(status, detected_at)`, `alerts(user_id, status)`, `dep_sources(source_id)`.

## 7. Components

### 7.1 Stack import
- **Public repo URL.** Fetch the default branch tree through the GitHub API (the App's token, for the higher rate limit) and read up to 30 known manifest files from the root and one level down: `package.json`, `deno.json(c)`, `bun.lockb`/`bunfig.toml`, `requirements*.txt`, `pyproject.toml`, `Pipfile`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, `Dockerfile` (base images), `docker-compose*.yml` (images), `.nvmrc`/`.node-version`/`.python-version`, `.github/workflows/*.yml` (`runs-on`, `uses`), `*.tf` (provider blocks), `wrangler.*`, `vercel.json`/`vercel.ts`, `fly.toml`, `netlify.toml`, `render.yaml`, `supabase/config.toml`.
- **Mapping.** Direct dependencies become `npm`/`pypi`/`crates`/`go` deps (each with its registry and GitHub repo sources). Runtime versions and Docker base images become `eol` deps. Files and package names in a catalog entry's `detect` become catalog deps.
- **Limit what's shown.** By default, only show catalog deps, runtimes and **the top 25 packages by importance** (direct dependency, not dev-only, ranked by whether it is a framework or SDK in the catalog, then by registry download count). The rest are imported but collapsed under "also watching".
- **Private repos** need the GitHub App installed on that repo (M5). On `push` webhooks to the default branch, re-import if a manifest changed.
- **Manual add (first step of onboarding, see §2 Positioning).** A "what do you run on?" picker: catalog entries grouped by category (hosting, database, auth, email, payments, runtime, self-hosted), searchable by name or alias, with the most common ones shown first. Free text that matches nothing is saved as a request for the catalog (admin view), not watched. Repo import is offered next to it as a shortcut that pre-fills the picker.
- **Usage profile.** For each catalog dep, ask only the questions in its `usage_questions`: "How do you use it? Hosted / self-hosted", "Commercial or personal?", "Free tier or paid?". Default from the project's `default_profile`. Skippable; unknown means "assume affected".

### 7.2 Watchers (cron)
- **Every 5 minutes** (`*/5 * * * *`): claim up to `JOBS_PER_TICK` due jobs (`UPDATE … SET locked_until = now+60s WHERE id IN (SELECT … WHERE run_after <= now AND (locked_until IS NULL OR locked_until < now) LIMIT n) RETURNING *`), run one step for each, then exit. Steps: `poll(source)` → maybe `extract_diff(source, old, new)` → maybe `classify(feed_item)` / `summarise(event)` → `fanout(event)` → `deliver(alert)`.
- **Daily** (`0 6 * * *`): schedule polls whose `next_poll_at` has passed, enqueue weekly digests on each user's `digest_day`, prune snapshots and old jobs, and roll up `llm_calls` cost for the admin view.
- **Every step MUST be idempotent and safe to retry.** Each step writes its result before enqueuing the next. A failed step retries with backoff (1 m, 5 m, 30 m, 2 h, 12 h), then is parked with `last_error`.
- **Budget guard.** Each step checks elapsed CPU-heavy work: text extraction and diffs are capped at 200 KB of input, and larger pages are rejected as `too_large` (fix the selector).

### 7.3 Event pipeline
1. **Detect.** A watcher creates an event with `status = pending_llm`, plus `before_text`/`after_text` (diffs, max 8 KB each) or the feed item's text, and `quote_url`.
   - Registry and GitHub metadata events (licence SPDX change, archived, deprecated, yanked) are **deterministic**. They skip the classifier and go straight to `summarise`.
2. **Classify** (feed items only, §7.4). Below 0.7 confidence or kind `other` → `rejected` (kept for audit).
3. **Summarise** (§7.4) → writes `note`, `quote`, `effective_date`, `applies_when`.
4. **Review gate.**
   - Auto-publish if confidence ≥ 0.9, the quote is found verbatim (after whitespace normalisation) in the fetched source text, and the kind is `license`, `eol`, `deprecated` or `archived`.
   - Otherwise → `pending_review`. The admin (the owner, at first) approves, edits or rejects it on `/admin/events`. One click to approve.
   - **The quote check is mandatory.** A note whose quote is not in the source is never auto-published.
5. **Fan out.** For each dep linked to the source, evaluate `applies_when` against `deps.profile` (rules only, no LLM): `affected | not_affected | unknown`. Create alerts for `affected` and `unknown`. Store `not_affected` as `suppressed`; they appear in the digest's "changes that don't affect you" section.
6. **Deliver** (§7.5).

### 7.4 LLM calls (Claude API)
- Client: `@anthropic-ai/sdk`. Model from `LLM_MODEL` (default `claude-opus-5-5`), `output_config: {effort: "low"}` for classify and `"medium"` for summarise. Use **structured outputs** (`output_config.format` with a JSON schema) for both. Do not use assistant prefill (rejected by current models). Include the server-side `fallbacks: "default"` parameter with beta `server-side-fallback-2026-07-01`, and handle `stop_reason: "refusal"` by parking the event for review.
- **Prompt caching.** The system prompt and the catalog entry come first and are marked `cache_control`; the variable text comes last.
- **Untrusted input.** Fetched pages and posts are data. The system prompt says so. Outputs are validated against the schema, and the quote check (§7.3) catches made-up text.
- **Classify** input: vendor name, post title, URL, and the first 6 k tokens of post text. Output:
  `{kind, confidence, effective_date|null, one_line, quote}`
- **Summarise** input: catalog entry (name, alternatives), event kind, before/after text or post text, URL. Output:
  ```json
  {
    "title": "Deno runtime development ends in about a year",
    "what_changed": "2–3 sentences, plain English",
    "quote": "verbatim sentence(s) from the source",
    "effective_date": "2027-10-09 | null",
    "applies_when": {"any": [{"profile.hosting": "self_hosted"}, {"profile.hosting": "hosted"}]},
    "who_is_not_affected": "one sentence or null",
    "options": [{"catalog_id": "nodejs", "why": "…", "effort": "low|medium|high"}],
    "uncertain": ["what the source does not say, e.g. whether the CLI licence changes"]
  }
  ```
- **Logging.** Write every call's token counts and computed cost to `llm_calls`. The daily job sends the admin an email if the 7-day cost exceeds `LLM_WEEKLY_BUDGET_USD` (default $10), and pauses `classify` (not `summarise`) above twice that budget.

### 7.5 Alerts and digest
- **Email (Resend).** Subject `[Stackquake] {catalog name}: {title}`. The body has the note sections in order, the quote as a blockquote with a link, "Affects you because: {profile match}", the options, and buttons for "Useful" / "Not relevant" / "Mute this dependency for 90 days" (signed one-click links).
- **Slack.** An incoming webhook per user or team. Same content as Block Kit. Verified with a test message when added.
- **Urgency.** `license`, `eol` with effective date within 180 days, `acquisition` with announced end of service, and `free_tier` go out immediately. Everything else waits for the weekly digest.
- **Rate limit.** At most 3 immediate alerts per user per day; the rest go into the next digest.
- **Digest.** Weekly on `digest_day`, sent only if there is something to say or it's the first digest of the month ("all quiet" is useful once a month, not weekly).

### 7.6 Web app
Routes (server-rendered):
- `/` landing page; `/pricing`; `/catalog` (public, searchable list of what's watched, an SEO page per entry at `/catalog/{id}` showing its recent public events); `/events` (public feed of published events, RSS at `/events.rss`).
- `/app` dashboard: projects, each listing dependencies grouped by **risk** (recent event, single vendor, no licence, archived) with the latest event per dep.
- `/app/projects/new` (paste repo URL, connect GitHub, or add manually), `/app/projects/{id}`, `/app/deps/{id}` (sources, profile, events, mute).
- `/app/settings` (email, digest day, Slack, plan, delete account).
- `/admin` (owner only, `ADMIN_EMAILS`): review queue, blocked sources, catalog requests, LLM cost, CPU-limit errors.
- Public event pages are a deliberate growth channel. Each one is a useful, linkable plain-English explanation of a change people are searching for that week.

## 8. Security
- Sessions: HttpOnly, Secure, SameSite=Lax cookies; CSRF token on every POST form.
- GitHub App permissions: `contents: read`, `metadata: read`, `push` webhook only. Webhook signatures verified (`X-Hub-Signature-256`).
- Fetched content is never rendered as HTML. Quotes and diffs are text-escaped.
- **SSRF.** Watchers only fetch URLs from the catalog or the fixed registry/GitHub/endoflife.date hosts. User input never becomes a fetch URL in v1.
- Signed one-click links (HMAC, 30-day expiry) for feedback and mute.
- Account deletion removes the user, projects, deps, alerts and channels. Sources and events are global and stay.

## 9. External interfaces (verify current shapes before coding)
- npm: `GET https://registry.npmjs.org/{pkg}` (use the `Accept: application/vnd.npm.install-v1+json` abbreviated form where it has the fields).
- PyPI: `GET https://pypi.org/pypi/{pkg}/json`.
- crates.io: `GET https://crates.io/api/v1/crates/{crate}` (needs a User-Agent).
- Go: `https://proxy.golang.org/{module}/@latest`, plus the module's repo for its licence.
- GitHub: `GET /repos/{owner}/{repo}` (`archived`, `license`, `owner`), `GET /repos/{owner}/{repo}/license`.
- endoflife.date: its public JSON API (check the current version and paths in their docs).
- Feeds: RSS 2.0 and Atom; parse with a small streaming parser, max 1 MB.

## 10. Plans and billing (M6)

| Plan | Price | Limits |
|---|---|---|
| Free | $0 | 1 project (public repo or manual), email alerts, weekly digest |
| Team | $19/mo or $190/yr | unlimited projects, private repos via the GitHub App, Slack, up to 10 members, CSV export of vendor risk |

Limits are enforced server-side when creating projects and channels. Stripe Checkout and a webhook set `users.plan` (same pattern as Beckon §10, idempotent by event ID).

## 11. Acceptance criteria and tests

**Golden set (M2).** `testdata/golden/` holds real cases with saved source snapshots and the expected result. It **MUST** include:
1. Deno blog post 2026-10-09 → kind `eol`, effective date about 2027-10, quote contains "end our development of the Deno runtime".
2. Bitwarden licence change → kind `license` (use the HN thread and any fetchable Bitwarden source; mark uncertain where the source is unavailable).
3. A Cloudflare Workers pricing page with a changed free allowance (synthetic edit of a saved snapshot) → kind `free_tier`, with before/after values.
4. A routine product-announcement post from the same blogs → classified `other`, no event.
5. A pricing page whose only change is a "last updated" timestamp → no LLM call, no event.
6. An npm package whose licence changes from `MIT` to `BUSL-1.1` (fixture) → deterministic `license` event, auto-published.
7. A GitHub repo becoming archived (fixture) → `archived` event.
8. Five more feed posts that are not deal changes → no event.

`npm run eval` runs the golden set against the live model and reports precision and recall per kind and the cost. **Pass bar: no false positive among the "no event" cases, all deal changes found, and every quote found verbatim in the source.**

**Unit tests:**
- Normalisation removes timestamps and tracking parameters, so the same page fetched twice hashes the same.
- Manifest parsers: one fixture per manifest type in §7.1, including a monorepo with two `package.json` files.
- `applies_when` evaluation for each profile combination, including the unknown profile → `unknown`.
- Job runner: a step that throws is retried with backoff; two ticks running at once never run the same job (lock test).
- Dedupe: the same announcement seen via a feed and a page creates one event.
- Rate limit: a 4th immediate alert in a day goes into the digest.

**End-to-end (Miniflare):**
- E1: Paste a fixture repo URL (GitHub API mocked) → dashboard shows the expected catalog deps and runtimes in under 60 s.
- E2: A source's snapshot changes → event → (LLM mocked) note → published → an email for an affected user and a suppressed alert for an unaffected user.
- E3: A note whose quote is not in the source stays `pending_review` and sends nothing.
- E4: With the LLM weekly budget exceeded, `classify` jobs pause and an admin email is sent.
- E5: A full cron tick with `JOBS_PER_TICK` = 10 against fixture sources stays under 10 ms CPU per invocation in `wrangler dev --test-scheduled` measurements (logged; a warning, not a failure, since local timing differs from production).

## 12. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M1 | Watcher engine: source kinds, fetch + normalise + hash + snapshot, job runner, catalog loader with 10 starter entries, local CLI `npm run poll -- <source>` | Unit tests for normalisation, job runner and dedupe pass; polling the 10 starter entries twice produces no false changes |
| M2 | Event pipeline: classify, summarise, quote check, review gate, admin review page (minimal), golden set + `npm run eval` | Golden set passes the bar in §11 |
| M3 | Web app: auth (GitHub + magic link), projects, **service picker first** (manual add from the catalog, §7.1), public repo import as a shortcut that pre-fills it, usage profiles, dashboard, public catalog and event pages. Grow the catalog to 25+ entries, mostly hosted services | E1 passes; a real public repo imports correctly; a user with no repo can build a stack from the picker in under 60 s |
| M4 | Alerts: fan-out, email via Resend, Slack, digest, feedback and mute links, rate limit, LLM budget guard | E2, E3, E4 pass |
| M5 | GitHub App for private repos and push re-import; deploy staging and production to Cloudflare on stackquake.com; DNS for Resend; catalog grown to 40+ entries, at least two thirds hosted services and runtimes; competitor check (§2 Positioning) | Staging works end to end with a real email; production deployed but not announced |
| M6 | Plans, billing, landing page, public launch (Show HN); move to Workers Paid if CPU errors appear | A new user goes from sign-up to a populated dashboard in under 2 minutes in production |

**No public launch before the golden set passes on the production model and the review gate is on.**

## 13. Future (v2+, out of scope, design shouldn't preclude)
- Transitive dependency licence changes (with strong filtering).
- User-added URLs to watch (needs SSRF hardening and per-user cost limits).
- Team roles and a "vendor risk register" export for SOC 2 / procurement.
- Trust scores per vendor: history of licence changes, funding, acquisition, bus factor.
- An MCP server so coding agents can ask "is anything in this repo's stack changing?".
- Migration guides generated for common moves (Deno → Node, Bitwarden → Vaultwarden clients), each reviewed.
- Self-hosted edition (the Node entry point from §4.3).

## 14. Open questions (decide before or during M2)
1. **Name.** Stackquake, domain registered. Also register `stackquake.dev`? It was unregistered on 2026-10-10.
2. **LLM model.** The default is Opus 5.5 (about $10/month at the predicted volume). Haiku 5.5 would be under $1/month. Decide after running the golden set on both.
3. **User-added sources.** Users will ask to watch things not in the catalog. v1 collects requests and the owner adds them to the catalog. Is that acceptable at launch?
4. **Open source?** Open-sourcing the catalog (YAML) invites contributions and builds trust; the app can stay closed. Recommended: open catalog, closed app.
5. **Legal wording.** Notes summarise public statements. Add a short disclaimer on every note ("Summary, not legal advice; read the source") and get the terms page reviewed before charging.
